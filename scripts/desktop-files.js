const fs = require("node:fs");
const path = require("node:path");

function isPrivateFile(name) {
  return /^\.env(?:\.|$)/i.test(name) ||
    /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(name) ||
    /\.(?:pem|key|p12|pfx|log)$/i.test(name) ||
    [".npmrc", ".git", ".DS_Store"].includes(name);
}

function copyRecursiveSync(src, dest, { filter = () => true } = {}) {
  if (isPrivateFile(path.basename(src)) || !filter(path.basename(src))) return;
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, name), path.join(dest, name), { filter });
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

module.exports = { copyRecursiveSync, isPrivateFile };
