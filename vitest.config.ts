import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.dirname(fileURLToPath(import.meta.url)) } },
  // e2e/ holds Playwright specs, run against a real deployment via `pnpm e2e`.
  // Vitest must not collect them: Playwright's test() throws outside its own runner,
  // which fails `pnpm verify`.
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.vercel/**",
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
      "e2e/**",
    ],
  },
});
