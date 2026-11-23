import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "workers", "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          limits: { cpuMs: 10 },
          bindings: {
            SECRET_KEY: "local-test-secret-at-least-32-characters",
            CORS_ORIGINS: "https://hoangdzstore.pages.dev,http://localhost:5500,http://127.0.0.1:5500",
            TEST_MIGRATIONS: migrations
          }
        }
      })
    ],
    test: {
      include: ["tests/**/*.test.ts"],
      setupFiles: ["./tests/apply-migrations.ts"]
    }
  };
});
