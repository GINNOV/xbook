#!/usr/bin/env node
/**
 * Build latest.json / update.json for the Tauri updater from a signed macOS build.
 *
 * Usage (after `npx tauri build` with TAURI_SIGNING_PRIVATE_KEY set):
 *   node scripts/write-update-manifest.js
 *   node scripts/write-update-manifest.js --out update.json --upload-name xbook.app.tar.gz
 *
 * Writes:
 *   - dist-release/latest.json
 *   - update.json (repo root, served from main as fallback endpoint)
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;

const macosDir = path.join(root, "src-tauri", "target", "release", "bundle", "macos");
const tarName = "xbook.app.tar.gz";
const sigName = "xbook.app.tar.gz.sig";
const tarPath = path.join(macosDir, tarName);
const sigPath = path.join(macosDir, sigName);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(tarPath)) {
  fail(`Missing updater archive: ${tarPath}\nRun a signed desktop build first (createUpdaterArtifacts + TAURI_SIGNING_PRIVATE_KEY).`);
}
if (!fs.existsSync(sigPath)) {
  fail(`Missing signature: ${sigPath}\nEnsure createUpdaterArtifacts is true and the private key was set during build.`);
}

const signature = fs.readFileSync(sigPath, "utf8").trim();
const tag = `xbook-v${version}`;
const baseUrl = `https://github.com/GINNOV/xbook/releases/download/${tag}`;

// Universal / arch-specific: this machine's build is registered for both common macOS keys
// when we only ship one artifact (typical for local arm64 or x86_64 release builds).
const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const platformKey = `darwin-${arch}`;
const url = `${baseUrl}/${tarName}`;

const { releaseNotes, loadChangelog } = require("./changelog-notes");
const changelogNotes = (() => {
  try {
    return releaseNotes({ version, changelogMarkdown: loadChangelog(root) });
  } catch {
    return {
      notes: `XBook Console ${version}`,
      updaterNotes: `XBook Console ${version}`,
    };
  }
})();
const notesFromChangelog = changelogNotes.updaterNotes;

const manifest = {
  version,
  notes: notesFromChangelog,
  pub_date: new Date().toISOString(),
  platforms: {
    [platformKey]: {
      signature,
      url,
    },
  },
};

// If only one arch was built, also map the other common macOS key only when explicitly requested.
// Default: single-arch accuracy (arm64 M-series is the primary target).

const outDir = path.join(root, "dist-release");
fs.mkdirSync(outDir, { recursive: true });

const latestPath = path.join(outDir, "latest.json");
const updatePath = path.join(root, "update.json");
const releaseNotesPath = path.join(outDir, "RELEASE_NOTES.md");

const json = JSON.stringify(manifest, null, 2) + "\n";
fs.writeFileSync(latestPath, json);
fs.writeFileSync(updatePath, json);
if (changelogNotes.notes) {
  fs.writeFileSync(releaseNotesPath, `${changelogNotes.notes}\n`);
}

console.log(`Wrote ${latestPath}`);
console.log(`Wrote ${updatePath}`);
if (changelogNotes.notes) {
  console.log(`Wrote ${releaseNotesPath}`);
}
console.log(`Platform: ${platformKey}`);
console.log(`URL: ${url}`);
console.log(`Version: ${version}`);
