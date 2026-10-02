import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
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
