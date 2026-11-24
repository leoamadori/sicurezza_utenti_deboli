import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

interface PackageJson {
  version: string;
}

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as PackageJson;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/domain/**",
        "src/coordinator/**",
        "src/storage/**",
        "src/fsm/**",
        "src/export/pngLayout.ts",
      ],
      exclude: ["src/domain/types.ts"],
      thresholds: {
        branches: 90,
      },
    },
  },
});
