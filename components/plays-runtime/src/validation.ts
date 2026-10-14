import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import YAML from "yaml";

const schemaDirectory = fileURLToPath(new URL("../schema/", import.meta.url));

async function validateFile(file: string, schemaName: string): Promise<string[]> {
  const schema = JSON.parse(await readFile(path.join(schemaDirectory, schemaName), "utf8"));
  const value = YAML.parse(await readFile(file, "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => `${file}${error.instancePath || "/"} ${error.message}`);
}

export async function schemaErrors(directory: string): Promise<string[]> {
  const errors = [
    ...await validateFile(path.join(directory, "play.yaml"), "play.schema.json"),
    ...await validateFile(path.join(directory, "team.yaml"), "team.schema.json"),
  ];
  const players = path.join(directory, "players");
  for (const entry of await readdir(players, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    errors.push(...await validateFile(path.join(players, entry.name, "player.yaml"), "player.schema.json"));
  }
  return errors;
}

export async function validateSchemas(directory: string): Promise<void> {
  const errors = await schemaErrors(directory);
  if (errors.length) throw new Error(errors.join("\n"));
}
