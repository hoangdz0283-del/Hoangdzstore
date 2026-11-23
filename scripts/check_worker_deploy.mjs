import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const database = config.d1_databases?.find(binding => binding.binding === "DB");

if (!database || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(database.database_id) ||
    database.database_id === "00000000-0000-0000-0000-000000000001") {
  console.error("Deployment blocked: set the actual D1 database_id in wrangler.jsonc first.");
  process.exit(1);
}

if (database.database_name !== "hoangdzstore-db") {
  console.error("Deployment blocked: the D1 database name must be hoangdzstore-db.");
  process.exit(1);
}

if (!config.vars?.CORS_ORIGINS?.split(",").map(value => value.trim()).includes("https://hoangdzstore.pages.dev")) {
  console.error("Deployment blocked: allow the exact Cloudflare Pages origin in CORS_ORIGINS.");
  process.exit(1);
}

if (config.vars?.ANALYTICS_MODE !== "demo" || (config.r2_buckets || []).length > 0) {
  console.error("Deployment blocked: analytics must use synthetic demo data without R2 bindings.");
  process.exit(1);
}

console.log("Worker deployment configuration is structurally ready; verify secrets and D1 data before deployment.");
