import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Build output and local tool state.
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "dist/**",
    "out/**",
    "next-env.d.ts",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      // Vendored verbatim from the shadcn registry; keep the upstream source
      // intact while applying the stricter rules to LSE code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Tests assert on JSON parsed from CLI/API output, which is untyped by
      // nature; product code stays under the strict rule.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
