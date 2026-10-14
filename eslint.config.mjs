import { FlatCompat } from "@eslint/eslintrc";
import { globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: fileURLToPath(new URL(".", import.meta.url)) });

const config = [
  // .vercel holds compiled build output, same as .next. Linting it reported 18 errors in
  // minified vendor chunks and hid the real source signal.
  globalIgnores([".next/**", ".vercel/**", "out/**", "build/**", "next-env.d.ts"]),
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: { "@next/next/no-page-custom-font": "off" },
  },
];

export default config;
