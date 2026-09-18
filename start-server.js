const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Database and configuration directory (stored outside the app bundle in a known location)
const home = os.homedir();
const appDir = process.env.XBOOK_DATA_DIR || (process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "xbook")
  : path.join(home, ".xbook"));
process.env.HOSTNAME = "127.0.0.1";

// Ensure the directory exists
if (!fs.existsSync(appDir)) {
  fs.mkdirSync(appDir, { recursive: true });
}

// Set up server logging to a file in the app support directory
const logFile = path.join(appDir, "server.log");
const logStream = fs.createWriteStream(logFile, { flags: "a" });

// Write a session divider
logStream.write(`\n--- Server Session Started: ${new Date().toISOString()} ---\n`);

// Helper to log errors safely
function logInternalError(message, error) {
  const errMsg = `[xbook-server] ${message}: ${error ? error.stack || error.message || error : ""}\n`;
  logStream.write(errMsg);
  try {
    process.stderr.write(errMsg);
  } catch (e) {}
}

// Redirect stdout and stderr so that we capture all console outputs
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = (chunk, encoding, callback) => {
  try {
    logStream.write(chunk, encoding);
  } catch (e) {}
  return originalStdoutWrite(chunk, encoding, callback);
};

process.stderr.write = (chunk, encoding, callback) => {
  try {
    logStream.write(chunk, encoding);
  } catch (e) {}
  return originalStderrWrite(chunk, encoding, callback);
};

const dbPath = path.join(appDir, "dev.db");
process.env.DATABASE_URL = `file:${dbPath.split(path.sep).join("/")}`;
console.log(`[xbook-server] Using database at: ${dbPath}`);

// Run Prisma migrations dynamically
try {
  // Prisma's schema engine requires an existing SQLite file on a fresh install.
  fs.closeSync(fs.openSync(dbPath, "a", 0o600));
  const prismaCliPath = path.join(__dirname, "node_modules", "prisma", "build", "index.js");
  const schemaPath = path.join(__dirname, "prisma", "schema.prisma");
  const prismaConfigPath = path.join(__dirname, "prisma.runtime.config.mjs");

  console.log("[xbook-server] Checking database migrations...");
  if (fs.existsSync(prismaCliPath) && fs.existsSync(schemaPath)) {
    // Redirect migration process output directly to log file
    const logFd = fs.openSync(logFile, "a");
    try {
      execFileSync(process.execPath, [prismaCliPath, "migrate", "deploy", "--config", prismaConfigPath], {
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        cwd: appDir,
        windowsHide: true,
      });
    } finally {
      fs.closeSync(logFd);
    }
    console.log("[xbook-server] Database migrations successfully applied.");
  } else {
    throw new Error("Packaged Prisma CLI or schema.prisma is missing");
  }
} catch (err) {
  logInternalError("Database migration failed", err);
  process.exit(1);
}

// Start the Next.js server
console.log("[xbook-server] Starting Next.js standalone server...");
require("./server.js");
