const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { copyRecursiveSync } = require("../../scripts/desktop-files");

test("packaging copies runtime assets but excludes credentials and local databases at every depth", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-files-"));
  try {
    const source = path.join(temp, "source");
    const target = path.join(temp, "target");
    fs.mkdirSync(path.join(source, "nested"), { recursive: true });
    const privateFiles = [".env", ".env.local", ".env.production", "dev.db", "dev.db-wal",
      "backup.sqlite3", "private.key", "certificate.pem", ".npmrc", "server.log"];
    for (const dir of [source, path.join(source, "nested")]) {
      for (const name of [...privateFiles, "server.js", "migration.sql", "better_sqlite3.node", "node.exe"]) {
        fs.writeFileSync(path.join(dir, name), "fixture");
      }
    }
    copyRecursiveSync(source, target);
    for (const dir of [target, path.join(target, "nested")]) {
      assert.deepEqual(fs.readdirSync(dir).filter(name => name !== "nested").sort(),
        ["better_sqlite3.node", "migration.sql", "node.exe", "server.js"]);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
