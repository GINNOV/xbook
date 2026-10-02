const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

function runtimePaths(env = process.env) {
  const supplied = env.DATABASE_URL;
  const databasePath = supplied
    ? path.resolve(supplied.startsWith("file:") ? supplied.slice(5) : supplied)
    : path.join(os.homedir(), ".xbook", "dev.db");
  return { databasePath, databaseUrl: `file:${databasePath}`, logFile: path.join(path.dirname(databasePath), "server.log") };
}

/** The compiled application maintenance module recovers before migrations. */
async function prepareDatabaseStartup({ databasePath, migrate, loadMaintenance = () => require("./database-maintenance.cjs"), wait = true }) {
  const { DatabaseMaintenance } = loadMaintenance();
  const maintenance = new DatabaseMaintenance(databasePath);
  await maintenance.exclusive(async (ownership) => {
    // exclusive has recovered any interrupted replacement before this callback.
    // Prisma's SQLite engine requires an existing file on first launch.
    if (!fs.existsSync(databasePath)) {
      const Database = require("better-sqlite3");
      const fresh = new Database(databasePath);
      fresh.close();
    }
    maintenance.invalidate(ownership);
    await migrate();
  }, wait);
}

function migrateDatabase({ serverDirectory, databaseUrl, logFile }) {
  const prismaCliPath = path.join(serverDirectory, "node_modules", "prisma", "build", "index.js");
  const schemaPath = path.join(serverDirectory, "prisma", "schema.prisma");
  const prismaConfigPath = path.join(serverDirectory, "prisma.runtime.config.mjs");
  if (!fs.existsSync(prismaCliPath) || !fs.existsSync(schemaPath)) {
    throw new Error("Packaged Prisma migration runtime or schema is missing.");
  }
  fs.writeFileSync(prismaConfigPath, [
    'import { defineConfig } from "prisma/config";',
    "export default defineConfig({",
    '  schema: "prisma/schema.prisma",',
    '  migrations: { path: "prisma/migrations" },',
    '  datasource: { url: process.env.DATABASE_URL },',
    "});", "",
  ].join("\n"));
  const logFd = fs.openSync(logFile, "a");
  try {
    execFileSync(process.execPath, [prismaCliPath, "migrate", "deploy", `--config=${prismaConfigPath}`], {
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: serverDirectory,
    });
  } finally { fs.closeSync(logFd); }
}

async function bootstrap() {
  const paths = runtimePaths();
  fs.mkdirSync(path.dirname(paths.databasePath), { recursive: true });
  const logStream = fs.createWriteStream(paths.logFile, { flags: "a", mode: 0o600 });
  logStream.write(`\n--- Server Session Started: ${new Date().toISOString()} ---\n`);
  for (const output of [process.stdout, process.stderr]) {
    const original = output.write.bind(output);
    output.write = (chunk, encoding, callback) => {
      logStream.write(chunk, encoding);
      return original(chunk, encoding, callback);
    };
  }
  process.env.DATABASE_URL = paths.databaseUrl;
  console.log(`[xbook-server] Using database at: ${paths.databasePath}`);
  console.log("[xbook-server] Recovering database and checking migrations...");
  await prepareDatabaseStartup({
    databasePath: paths.databasePath,
    migrate: () => migrateDatabase({ serverDirectory: __dirname, databaseUrl: paths.databaseUrl, logFile: paths.logFile }),
  });
  console.log("[xbook-server] Database recovery and migrations complete.");
  console.log("[xbook-server] Starting Next.js standalone server...");
  require("./server.js");
}

module.exports = { runtimePaths, prepareDatabaseStartup, migrateDatabase };
if (require.main === module) {
  bootstrap().catch((error) => { console.error("[xbook-server] Database startup failed:", error); process.exitCode = 1; });
}
