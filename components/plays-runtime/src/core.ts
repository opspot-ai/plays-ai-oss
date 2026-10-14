import { createHash } from "node:crypto";
import { access, appendFile, chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { parse as parseToml } from "smol-toml";
import { validateSchemas } from "./validation.js";
import type {
  LoadedTeam,
  PlayManifest,
  PlayerManifest,
  PlaysConfig,
  Provider,
  TeamManifest,
  ToolRequirement,
} from "./types.js";

const API_BASE = () => process.env.PLAYS_API_URL || "http://localhost:4720";
const LICENSE_SERVICE = "plays.ai/license";
const CLI_VERSION = "2.0.0";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function bundlePath(root: string, slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`invalid play slug: ${slug}`);
  return path.join(root, ".plays", slug);
}

export async function loadManifest(root: string, slug: string): Promise<PlayManifest> {
  const file = path.join(bundlePath(root, slug), "play.yaml");
  const manifest = YAML.parse(await readFile(file, "utf8")) as PlayManifest;
  if (manifest.spec !== "playbundle/v2" || manifest.play !== slug || manifest.team !== "team.yaml") {
    throw new Error(`${file} is not ${slug} playbundle/v2`);
  }
  return manifest;
}

async function loadTeamDirectory(directory: string, manifest: PlayManifest): Promise<LoadedTeam> {
  const team = YAML.parse(await readFile(path.join(directory, manifest.team), "utf8")) as TeamManifest;
  if (team.spec !== "playteam/v1" || !ID.test(team.quarterback)) throw new Error("invalid team.yaml");
  const ids = team.lineup.map(({ player }) => player);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate Player in Team");
  if (team.lineup.filter(({ position }) => position === "quarterback").length !== 1) {
    throw new Error("Team must have exactly one quarterback");
  }
  if (team.lineup.find(({ position }) => position === "quarterback")?.player !== team.quarterback) {
    throw new Error("quarterback must match the quarterback lineup entry");
  }
  const lineup = new Map(team.lineup.map((member) => [member.player, member]));
  const players: LoadedTeam["players"] = {};
  for (const member of team.lineup) {
    if (!ID.test(member.player) || member.steps.length === 0) throw new Error(`invalid Team member ${member.player}`);
    const playerDirectory = path.join(directory, "players", member.player);
    const player = YAML.parse(await readFile(path.join(playerDirectory, "player.yaml"), "utf8")) as PlayerManifest;
    if (player.spec !== "playplayer/v1" || player.id !== member.player) throw new Error(`invalid Player ${member.player}`);
    players[member.player] = {
      manifest: player,
      instructions: await readFile(path.join(playerDirectory, "PLAYER.md"), "utf8"),
    };
  }
  for (const route of manifest.routing) {
    const member = lineup.get(route.player);
    if (!member || !member.steps.includes(route.step)) {
      throw new Error(`routing step ${route.step} is not assigned to Player ${route.player}`);
    }
  }
  for (const handoff of team.handoffs) {
    if (!lineup.has(handoff.from) || !lineup.has(handoff.to) || !handoff.artifact) {
      throw new Error(`invalid handoff ${handoff.id}`);
    }
    if (handoff.schema && (path.isAbsolute(handoff.schema) || handoff.schema.split("/").includes(".."))) {
      throw new Error(`unsafe handoff schema ${handoff.schema}`);
    }
  }
  return { team, players };
}

export async function loadTeam(root: string, slug: string): Promise<LoadedTeam> {
  const manifest = await loadManifest(root, slug);
  return loadTeamDirectory(bundlePath(root, slug), manifest);
}

export async function validateBundle(directory: string): Promise<{ manifest: PlayManifest; loaded: LoadedTeam }> {
  await validateSchemas(directory);
  const manifest = YAML.parse(await readFile(path.join(directory, "play.yaml"), "utf8")) as PlayManifest;
  if (manifest.spec !== "playbundle/v2" || manifest.team !== "team.yaml" || !ID.test(manifest.play)) {
    throw new Error("unsupported or invalid bundle");
  }
  return { manifest, loaded: await loadTeamDirectory(directory, manifest) };
}

export async function loadConfig(root: string): Promise<PlaysConfig> {
  const parsed = parseToml(await readFile(path.join(root, "plays.toml"), "utf8")) as unknown as PlaysConfig;
  parsed.providers ??= {};
  parsed.routing ??= { order: [], spillover: true, on_all_exhausted: "pause-and-resume" };
  return parsed;
}

async function commandExists(command: string): Promise<boolean> {
  return spawnSync("sh", ["-c", "command -v \"$1\" >/dev/null 2>&1", "plays", command], {
    stdio: "ignore",
  }).status === 0;
}

async function secretExists(requirement: PlayManifest["requires"]["secrets"][number]): Promise<string | null> {
  for (const resolver of requirement.resolver) {
    if (resolver === "env" && process.env[requirement.key]) return "env";
    if (resolver === "keychain" && platform() === "darwin") {
      const result = spawnSync("security", ["find-generic-password", "-s", `plays:${requirement.key}`, "-w"], {
        encoding: "utf8",
      });
      if (result.status === 0 && result.stdout.trim()) return "keychain";
    }
    if (resolver.startsWith("op://") && await commandExists("op")) {
      const result = spawnSync("op", ["read", resolver], { encoding: "utf8" });
      if (result.status === 0 && result.stdout.trim()) return "op";
    }
  }
  return null;
}

async function toolStatus(tool: ToolRequirement): Promise<boolean> {
  if (tool.binding.kind === "builtin") return true;
  if (tool.binding.kind === "executable" && tool.binding.command) {
    return commandExists(tool.binding.command.split(/\s+/)[0]);
  }
  if (tool.binding.kind === "any-of") {
    for (const suggestion of tool.binding.suggest ?? []) {
      const command = suggestion.replace(/^mcp:/, "").split(/\s+/)[0];
      if (command === "harness-builtin" || await commandExists(command)) return true;
    }
  }
  return false;
}

async function providerStatus(provider: Provider): Promise<boolean> {
  if (provider.kind === "subscription") return Boolean(provider.exec && await commandExists(provider.exec.split(" ")[0]));
  if (!provider.base_url) return false;
  try {
    const response = await fetch(`${provider.base_url.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function doctor(root: string, slug: string): Promise<boolean> {
  const manifest = await loadManifest(root, slug);
  const config = await loadConfig(root);
  let runnable = true;
  console.log("kind      requirement                  status");

  for (const tool of manifest.requires.tools) {
    const present = await toolStatus(tool);
    const status = present ? "present" : tool.optional ? `degraded: ${tool.degrade}` : "missing";
    console.log(`tool      ${tool.id.padEnd(28)} ${status}`);
    if (!present && !tool.optional) runnable = false;
  }
  for (const secret of manifest.requires.secrets) {
    const resolver = await secretExists(secret);
    const status = resolver ? `resolved-from ${resolver}` : secret.optional ? "optional-missing" : "missing";
    console.log(`secret    ${secret.key.padEnd(28)} ${status}`);
    if (!resolver && !secret.optional) runnable = false;
  }

  const providers = Object.entries(config.providers).map(([name, provider]) => ({ name, ...provider }));
  if (manifest.routing.some((step) => step.tier !== "none") && providers.length === 0) {
    console.log("provider  configured                   missing");
    runnable = false;
  }
  for (const provider of providers) {
    console.log(`provider  ${provider.name.padEnd(28)} ${await providerStatus(provider) ? "reachable" : "not-reachable"}`);
  }
  for (const cap of manifest.requires.caps) {
    console.log(`cap       ${cap.id.padEnd(28)} ${config.caps?.[cap.id] ?? cap.default}${cap.unit ? ` ${cap.unit}` : ""}`);
  }
  return runnable;
}

async function hashDirectory(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute);
      if (entry.isDirectory()) await walk(absolute);
      else {
        hash.update(relative);
        hash.update("\0");
        hash.update(await readFile(absolute));
      }
    }
  }
  await walk(directory);
  return hash.digest("hex");
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function findBundleDirectory(directory: string): Promise<string> {
  try {
    await access(path.join(directory, "play.yaml"));
    return directory;
  } catch {
    const children = await readdir(directory, { withFileTypes: true });
    const matches: string[] = [];
    for (const child of children) {
      if (!child.isDirectory()) continue;
      try {
        await access(path.join(directory, child.name, "play.yaml"));
        matches.push(path.join(directory, child.name));
      } catch {
        // Not a bundle root.
      }
    }
    if (matches.length !== 1) throw new Error("tarball must contain exactly one play.yaml root");
    return matches[0];
  }
}

async function extractTarball(file: string, destination: string): Promise<string> {
  const listing = spawnSync("tar", ["-tzf", file], { encoding: "utf8" });
  if (listing.status !== 0) throw new Error(`cannot inspect tarball: ${listing.stderr.trim()}`);
  for (const name of listing.stdout.split("\n").filter(Boolean)) {
    if (path.isAbsolute(name) || name.split("/").includes("..")) throw new Error(`unsafe tar path: ${name}`);
  }
  const extraction = spawnSync("tar", ["-xzf", file, "-C", destination], { encoding: "utf8" });
  if (extraction.status !== 0) throw new Error(`cannot extract tarball: ${extraction.stderr.trim()}`);
  return findBundleDirectory(destination);
}

async function fetchTarball(slug: string): Promise<{ file: string; sha: string; licenseId: string; orderingSalt: string; cleanup: string }> {
  const license = await getLicense();
  if (!license) throw new Error("no license stored; run plays login");
  const response = await fetch(`${API_BASE()}/api/download?sku=${encodeURIComponent(slug)}`, {
    headers: { authorization: `Bearer ${license}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const delivery = await response.json() as { url: string; sha256: string; licenseId: string; orderingSalt: string };
  const tarball = await fetch(delivery.url);
  if (!tarball.ok) throw new Error(`signed download failed (${tarball.status})`);
  const cleanup = await mkdtemp(path.join(tmpdir(), "plays-download-"));
  const file = path.join(cleanup, `${slug}.tgz`);
  const bytes = new Uint8Array(await tarball.arrayBuffer());
  await writeFile(file, bytes);
  const actualSha = await hashFile(file);
  if (actualSha !== delivery.sha256) throw new Error("download SHA-256 mismatch");
  return {
    file,
    sha: actualSha,
    licenseId: delivery.licenseId,
    orderingSalt: delivery.orderingSalt,
    cleanup,
  };
}

async function resolveSource(source: string): Promise<{ directory: string; sha: string; licenseId: string; orderingSalt: string; cleanup?: string }> {
  try {
    const info = await stat(path.resolve(source));
    if (info.isDirectory()) {
      const directory = await findBundleDirectory(path.resolve(source));
      return { directory, sha: await hashDirectory(directory), licenseId: "local-development", orderingSalt: "local-development" };
    }
    const cleanup = await mkdtemp(path.join(tmpdir(), "plays-extract-"));
    return {
      directory: await extractTarball(path.resolve(source), cleanup),
      sha: await hashFile(path.resolve(source)),
      licenseId: "local-development",
      orderingSalt: "local-development",
      cleanup,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const downloaded = await fetchTarball(source);
  const extract = path.join(downloaded.cleanup, "extract");
  await mkdir(extract);
  const directory = await extractTarball(downloaded.file, extract);
  return {
    directory,
    sha: downloaded.sha,
    licenseId: downloaded.licenseId,
    orderingSalt: downloaded.orderingSalt,
    cleanup: downloaded.cleanup,
  };
}

async function writeIfMissing(file: string, content: string): Promise<void> {
  try {
    await access(file);
  } catch {
    await writeFile(file, content);
  }
}

function adapterBlock(manifest: PlayManifest, loaded: LoadedTeam): string {
  const formation = loaded.team.lineup
    .map(({ player, position, assignment }) => `- ${loaded.players[player].manifest.name} (${position}): ${assignment}`)
    .join("\n");
  return [
    `<!-- plays:begin ${manifest.play} -->`,
    `## Play: ${manifest.name}`,
    "",
    `Read \`.plays/${manifest.play}/play.yaml\`, \`.plays/${manifest.play}/team.yaml\`, the assigned Player files, and \`.plays/${manifest.play}/steps/\`.`,
    `Run the Team to this outcome: ${manifest.outcome}`,
    "",
    formation,
    "",
    `Buyer overrides, when present, are under \`.plays-local/${manifest.play}/players/\` and win over seller defaults without editing seller files.`,
    "Routing is advisory in this in-harness adapter; the active harness chooses models it can access.",
    `Honor the cursor and kill file under \`.plays/state/\`.`,
    `<!-- plays:end ${manifest.play} -->`,
  ].join("\n");
}

function playerPrompt(manifest: PlayManifest, loaded: LoadedTeam, player: string): string {
  const member = loaded.team.lineup.find((entry) => entry.player === player);
  if (!member) throw new Error(`Player ${player} is not on this Team`);
  const core = loaded.players[player];
  return [
    `# ${core.manifest.name}`,
    "",
    `Play: ${manifest.name}`,
    `Position: ${member.position}`,
    `Assignment: ${member.assignment}`,
    `Assigned steps: ${member.steps.join(", ")}`,
    "",
    core.instructions.trim(),
    "",
    `Read buyer overrides from .plays-local/${manifest.play}/players/${player}.md when present.`,
    "Read only the current step and declared handoff artifacts. Do not load credentials or unrelated memory.",
  ].join("\n");
}

export async function generateAdapters(root: string, manifest: PlayManifest, loaded?: LoadedTeam): Promise<void> {
  const team = loaded ?? await loadTeam(root, manifest.play);
  const block = adapterBlock(manifest, team);
  const agentsFile = path.join(root, "AGENTS.md");
  let agents = "";
  try { agents = await readFile(agentsFile, "utf8"); } catch {}
  const pattern = new RegExp(`<!-- plays:begin ${manifest.play} -->[\\s\\S]*?<!-- plays:end ${manifest.play} -->`);
  agents = pattern.test(agents)
    ? agents.replace(pattern, block)
    : `${agents}${agents && !agents.endsWith("\n") ? "\n" : ""}${agents ? "\n" : ""}${block}\n`;
  await writeFile(agentsFile, agents);

  await mkdir(path.join(root, ".claude", "agents"), { recursive: true });
  await mkdir(path.join(root, ".codex", "agents"), { recursive: true });
  await mkdir(path.join(root, ".cursor", "rules"), { recursive: true });
  await mkdir(path.join(root, ".plays", "bin"), { recursive: true });
  for (const member of team.team.lineup) {
    const prompt = playerPrompt(manifest, team, member.player);
    const id = `${manifest.play}-${member.player}`;
    await writeFile(path.join(root, ".claude", "agents", `${id}.md`), [
      "---",
      `name: ${id}`,
      `description: ${JSON.stringify(`${team.players[member.player].manifest.name}, ${member.position} for ${manifest.name}`)}`,
      "model: inherit",
      "---",
      "",
      prompt,
      "",
    ].join("\n"));
    await writeFile(path.join(root, ".codex", "agents", `${id}.toml`), [
      `name = ${JSON.stringify(id)}`,
      `description = ${JSON.stringify(`${team.players[member.player].manifest.name}, ${member.position} for ${manifest.name}`)}`,
      `developer_instructions = ${JSON.stringify(prompt)}`,
      "",
    ].join("\n"));
  }
  await writeFile(path.join(root, ".cursor", "rules", `play-${manifest.play}.mdc`), [
    "---",
    `description: ${manifest.name}`,
    "alwaysApply: false",
    "---",
    "",
    `Read .plays/${manifest.play}/team.yaml and route each step to its assigned Player.`,
    `Read .plays-local/${manifest.play}/players/ for buyer overrides.`,
    "",
  ].join("\n"));
  const shim = path.join(root, ".plays", "bin", manifest.play);
  await writeFile(shim, `#!/bin/sh\nexec plays run ${manifest.play} "$@"\n`);
  await chmod(shim, 0o755);
}

export async function install(root: string, source: string, force = false): Promise<{ slug: string; changed: boolean }> {
  const resolved = await resolveSource(source);
  try {
    const { manifest, loaded } = await validateBundle(resolved.directory);
    const target = bundlePath(root, manifest.play);
    try {
      const installed = await loadManifest(root, manifest.play);
      if (!force && installed.version === manifest.version) {
        console.log(`${manifest.play}@${manifest.version} already installed`);
        return { slug: manifest.play, changed: false };
      }
      if (!force) throw new Error(`${manifest.play} is installed at ${installed.version}; use plays update`);
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof Error && error.message.includes("already installed")) throw error;
        if (!force && await exists(target)) throw error;
      }
    }

    await mkdir(path.dirname(target), { recursive: true });
    const staging = `${target}.installing-${process.pid}`;
    await rm(staging, { recursive: true, force: true });
    await cp(resolved.directory, staging, { recursive: true });
    await writeFile(path.join(staging, ".play-receipt.json"), `${JSON.stringify({
      licenseId: resolved.licenseId,
      orderingSalt: resolved.orderingSalt,
      version: manifest.version,
      tarballSha256: resolved.sha,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    await rename(staging, target);
    const overrides = path.join(root, ".plays-local", manifest.play, "players");
    await mkdir(overrides, { recursive: true });
    await writeIfMissing(path.join(overrides, "README.md"), [
      `# ${manifest.name} Player overrides`,
      "",
      "Add `<player-id>.md` files here. These buyer-owned instructions are loaded after",
      "the seller Player core and survive `plays update`.",
      "",
    ].join("\n"));

    await writeIfMissing(path.join(root, "plays.toml"), [
      "# Buyer-owned provider bindings. Add only capacity you own.",
      "[routing]",
      "order = []",
      "spillover = true",
      'on_all_exhausted = "pause-and-resume"',
      "",
    ].join("\n"));
    const secretNames = manifest.requires.secrets.map(({ key }) => `${key}=`).join("\n");
    await writeFile(path.join(root, ".env.plays.example"), secretNames ? `${secretNames}\n` : "# No secrets required.\n");
    const ignore = path.join(root, ".gitignore");
    let ignored = "";
    try { ignored = await readFile(ignore, "utf8"); } catch {}
    if (!ignored.split(/\r?\n/).includes(".plays/state/")) {
      await appendFile(ignore, `${ignored && !ignored.endsWith("\n") ? "\n" : ""}.plays/state/\n`);
    }
    await generateAdapters(root, manifest, loaded);
    if (resolved.licenseId !== "local-development") {
      const license = await getLicense();
      const response = await fetch(`${API_BASE()}/api/install`, {
        method: "POST",
        headers: { authorization: `Bearer ${license}`, "content-type": "application/json" },
        body: JSON.stringify({ sku: manifest.play, sha256: resolved.sha, cliVersion: CLI_VERSION }),
      });
      if (!response.ok) console.warn(`install receipt was not recorded (${response.status})`);
    }
    console.log(`installed ${manifest.play}@${manifest.version}`);
    return { slug: manifest.play, changed: true };
  } finally {
    if (resolved.cleanup) await rm(resolved.cleanup, { recursive: true, force: true });
  }
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export async function storeLicense(token: string): Promise<void> {
  if (platform() === "darwin") {
    const result = spawnSync("security", ["add-generic-password", "-U", "-a", "license", "-s", LICENSE_SERVICE, "-w", token], {
      stdio: "ignore",
    });
    if (result.status === 0) return;
  } else if (platform() === "linux" && await commandExists("secret-tool")) {
    const result = spawnSync("secret-tool", ["store", "--label=plays.ai license", "service", "plays.ai", "account", "license"], {
      input: token,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (result.status === 0) return;
  }
  const directory = path.join(homedir(), ".config", "plays");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "credentials");
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  console.warn("OS keychain unavailable; license stored in a 0600 credentials file.");
}

export async function getLicense(): Promise<string | null> {
  if (process.env.PLAYS_LICENSE_KEY) return process.env.PLAYS_LICENSE_KEY;
  if (platform() === "darwin") {
    const result = spawnSync("security", ["find-generic-password", "-a", "license", "-s", LICENSE_SERVICE, "-w"], {
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  } else if (platform() === "linux" && await commandExists("secret-tool")) {
    const result = spawnSync("secret-tool", ["lookup", "service", "plays.ai", "account", "license"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  try {
    return (await readFile(path.join(homedir(), ".config", "plays", "credentials"), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

export async function login(token?: string): Promise<void> {
  const candidate = token || process.env.PLAYS_LICENSE_KEY;
  if (candidate) {
    const response = await fetch(`${API_BASE()}/api/license/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license: candidate }),
    });
    if (!response.ok) throw new Error(`license rejected (${response.status})`);
    await storeLicense(candidate);
    console.log("license stored");
    return;
  }

  const start = await fetch(`${API_BASE()}/api/device/start`, { method: "POST" });
  if (!start.ok) throw new Error("device login unavailable; set PLAYS_LICENSE_KEY and retry");
  const device = await start.json() as {
    device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number;
  };
  console.log(`Open ${device.verification_uri} and enter ${device.user_code}`);
  const deadline = Date.now() + device.expires_in * 1_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, device.interval * 1_000));
    const poll = await fetch(`${API_BASE()}/api/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: device.device_code }),
    });
    if (poll.status === 202) continue;
    if (!poll.ok) throw new Error(`device login failed (${poll.status})`);
    const { license } = await poll.json() as { license: string };
    await storeLicense(license);
    console.log("license stored");
    return;
  }
  throw new Error("device code expired");
}
