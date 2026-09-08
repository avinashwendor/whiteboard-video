import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Runtime wasm glue copied from node_modules by scripts/copy-assets.mjs.
    "public/vendor/**",
    // Read-only reference checkouts kept alongside the project, never built.
    "reference */**",
  ]),
]);

export default eslintConfig;
