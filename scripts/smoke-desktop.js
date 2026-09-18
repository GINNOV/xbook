const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { isPrivateFile } = require("./desktop-files");

const resources = path.resolve(__dirname, "../src-tauri/resources");
const node = path.join(resources, "bin", process.platform === "win32" ? "node.exe" : "node");
const server = path.join(resources, "server");

function checkResources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assert.ok(!isPrivateFile(entry.name), `Private file in bundle: ${path.join(dir, entry.name)}`);
    if (entry.isDirectory()) checkResources(path.join(dir, entry.name));
  }
}

async function smoke() {
  checkResources(resources);
  // Use the packaged runtime and addon, not the checkout's dependencies.
  execFileSync(node, ["-e", 'const DB = require("better-sqlite3"); const db = new DB(":memory:"); db.exec("SELECT 1"); db.close();'], {
    cwd: server, stdio: "inherit", windowsHide: true,
  });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xbook desktop "));
  const dataDir = path.join(temp, "user data");
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  try {
    // A second launch must reuse the migrated database successfully.
    for (let launch = 0; launch < 2; launch++) {
      const child = spawn(node, [path.join(server, "start-server.js")], {
        cwd: temp,
        env: { ...process.env, XBOOK_DATA_DIR: dataDir, PORT: String(port), NODE_ENV: "production" },
        stdio: "inherit", windowsHide: true,
      });
      const exited = once(child, "exit");
      try {
        let ready = false;
        for (let attempt = 0; attempt < 120; attempt++) {
          assert.equal(child.exitCode, null, "Packaged server exited before becoming ready");
          try {
            const response = await fetch(`http://127.0.0.1:${port}/settings`, { signal: AbortSignal.timeout(2000) });
            if (response.ok) { ready = true; break; }
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.ok(ready, "Packaged server did not serve Settings");
        assert.ok(fs.existsSync(path.join(dataDir, "dev.db")), "Missing user database");
        execFileSync(node, ["-e", 'const DB = require("better-sqlite3"); const db = new DB(process.argv[1]); if (!db.prepare("SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL").get().n) process.exit(1); db.prepare("SELECT count(*) FROM Settings").get(); db.close();', path.join(dataDir, "dev.db")], {
          cwd: server, stdio: "inherit", windowsHide: true,
        });
      } finally {
        child.kill();
        await exited;
      }
    }
    console.log("Packaged desktop server passed two launches, migrations and native SQLite checks.");
  } catch (error) {
    const log = path.join(dataDir, "server.log");
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, "utf8"));
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

smoke().catch(error => { console.error(error); process.exitCode = 1; });
