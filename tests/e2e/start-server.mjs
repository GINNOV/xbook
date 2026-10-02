import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Defined empty values take precedence over copied .env files in Next.
for (const key of ["X_BEARER_TOKEN", "X_USER_ID", "X_CLIENT_ID", "X_CLIENT_SECRET", "YT_CLIENT_ID", "YT_CLIENT_SECRET", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_EMBEDDING_MODEL"]) process.env[key] = "";
process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
process.env.X_API_BASE = "http://127.0.0.1:1/2";
writeFileSync(process.env.DATABASE_URL.slice(5), "", { flag: "wx" });

execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
  env: process.env,
  stdio: "inherit",
});
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--port", "3100"], {
  env: process.env,
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 1));
