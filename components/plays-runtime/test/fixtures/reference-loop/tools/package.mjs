#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("output", { recursive: true });
await writeFile("output/brief.md", "# Reviewed brief\n\nSynthetic fixture packaged successfully.\n");
