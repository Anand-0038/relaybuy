import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: [
      "src/live/**/*.{ts,tsx}",
      "src/app/api/live/**/*.{ts,tsx}",
      "src/components/live/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/replay/*",
                "@/persistence/*",
                "@/services/demo-*",
                "../replay/*",
                "../persistence/*",
                "../services/demo-*",
              ],
              message:
                "Canonical connected code must not import replay persistence or demo services.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);
