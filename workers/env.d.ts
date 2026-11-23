declare namespace Cloudflare {
  interface Env {
    SECRET_KEY: string;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
    AI_PROVIDER?: "workers-ai";
    AI_MODEL?: string;
  }
}

interface Env {
  SECRET_KEY: string;
  TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  AI_PROVIDER?: "workers-ai";
  AI_MODEL?: string;
}
