import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadManifest, loadTeam } from "./core.js";

export type NativeHarness = "hermes" | "openclaw";

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function writeBackedUp(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  if (await exists(file)) {
    const current = await readFile(file, "utf8");
    if (current === content) return;
    await writeFile(`${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`, current);
  }
  await writeFile(file, content);
}

function nativeId(play: string, player: string, alphanumeric = false): string {
  const value = `plays-${play}-${player}`;
  return alphanumeric ? value.replace(/[^a-z0-9]/g, "").slice(0, 48) : value;
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

export async function activate(root: string, slug: string, harness: NativeHarness, confirm = false): Promise<void> {
  const manifest = await loadManifest(root, slug);
  const loaded = await loadTeam(root, slug);
  const plan = loaded.team.lineup.map((member) => ({
    id: nativeId(slug, member.player, harness === "hermes"),
    player: member.player,
    name: loaded.players[member.player].manifest.name,
    position: member.position,
  }));
  console.log(JSON.stringify({ harness, play: slug, confirm, profiles: plan }, null, 2));
  if (!confirm) {
    console.log("preview only; rerun with --confirm to activate");
    return;
  }

  for (const entry of plan) {
    const prompt = [
      `# ${entry.name}`,
      "",
      `You are the ${entry.position} for ${manifest.name}.`,
      `Read ${path.join(root, ".plays", slug, "players", entry.player, "PLAYER.md")}.`,
      `Read ${path.join(root, ".plays", slug, "team.yaml")} for your assignment and handoffs.`,
      `Apply ${path.join(root, ".plays-local", slug, "players", `${entry.player}.md`)} if it exists.`,
      "Never copy credentials, runtime memory, or unrelated account state into this profile.",
      "",
    ].join("\n");

    if (harness === "hermes") {
      const hermesHome = process.env.PLAYS_HERMES_HOME;
      if (hermesHome) {
        const profile = path.join(hermesHome, "profiles", entry.id);
        await writeBackedUp(path.join(profile, "SOUL.md"), prompt);
        await writeBackedUp(path.join(profile, "config.yaml"), `terminal:\n  cwd: ${JSON.stringify(root)}\n`);
        continue;
      }
      const hermes = process.env.PLAYS_HERMES_BIN || "hermes";
      const shown = spawnSync(hermes, ["profile", "show", entry.id], { encoding: "utf8" });
      if (shown.status !== 0) {
        run(hermes, ["profile", "create", entry.id, "--no-alias", "--no-skills", "--description", `${entry.name}, ${entry.position} for ${manifest.name}`], root);
      }
      await writeBackedUp(path.join(homedir(), ".hermes", "profiles", entry.id, "SOUL.md"), prompt);
      continue;
    }

    const workspace = path.join(root, ".plays-activated", "openclaw", entry.id);
    await writeBackedUp(path.join(workspace, "AGENTS.md"), prompt);
    const openclawHome = process.env.PLAYS_OPENCLAW_HOME;
    if (openclawHome) {
      const configFile = path.join(openclawHome, "openclaw.json");
      const config = await exists(configFile)
        ? JSON.parse(await readFile(configFile, "utf8")) as { agents?: { list?: Array<Record<string, unknown>> } }
        : {};
      config.agents ??= {};
      config.agents.list ??= [];
      if (!config.agents.list.some((agent) => agent.id === entry.id)) {
        config.agents.list.push({
          id: entry.id,
          name: entry.name,
          workspace,
          agentDir: path.join(openclawHome, "agents", entry.id, "agent"),
          identity: { name: entry.name, theme: `${entry.position} for ${manifest.name}` },
        });
        await writeBackedUp(configFile, `${JSON.stringify(config, null, 2)}\n`);
      }
      continue;
    }
    const openclaw = process.env.PLAYS_OPENCLAW_BIN || "openclaw";
    const listed = spawnSync(openclaw, ["agents", "list", "--json"], { encoding: "utf8" });
    const already = listed.status === 0 && listed.stdout.includes(`"${entry.id}"`);
    if (!already) {
      run(openclaw, [
        "agents", "add", entry.id, "--non-interactive", "--workspace", workspace,
        "--agent-dir", path.join(homedir(), ".openclaw", "agents", entry.id, "agent"),
      ], root);
    }
  }
  console.log(`activated ${plan.length} ${harness} profiles for ${slug}`);
}
