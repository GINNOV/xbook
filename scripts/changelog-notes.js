#!/usr/bin/env node
/**
 * Build GitHub release notes and updater notes from CHANGELOG.md.
 * Always includes a clickable changelog URL (never a bare filename).
 *
 * Usage:
 *   node scripts/changelog-notes.js              # current package.json version → stdout
 *   node scripts/changelog-notes.js 0.4.2        # specific version
 *   node scripts/changelog-notes.js --updater    # compact updater notes
 */

const fs = require("fs");
const path = require("path");

const REPO = "https://github.com/GINNOV/xbook";

function changelogUrl(version) {
  return `${REPO}/blob/xbook-v${version}/CHANGELOG.md`;
}

function extractSection(markdown, version) {
  const escaped = version.replace(/\./g, "\\.");
  const match = markdown.match(new RegExp(`## \\[${escaped}\\][\\s\\S]*?(?=\\n## \\[|$)`));
  return match ? match[0].trim() : "";
}

function extractBullets(section, max = 5) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, max);
}

/** First sentence, capped — release notes stay short; details live in CHANGELOG. */
function headline(bullet) {
  const text = bullet.replace(/^-+\s*/, "").trim();
  const first = text.split(/(?<=\.)\s+/)[0] || text;
  if (first.length <= 140) return `- ${first}`;
  return `- ${first.slice(0, 137).trimEnd()}…`;
}

function releaseNotes({ version, changelogMarkdown, maxBullets = 5 }) {
  const url = changelogUrl(version);
  const section = extractSection(changelogMarkdown, version);
  const bullets = extractBullets(section, maxBullets).map(headline);
  const summary = bullets.length ? bullets.join("\n") : `XBook Console ${version}`;
  const notes = `${summary}\n\nDetails: [changelog](${url})`;
  let updaterNotes = `${summary}\n\n${url}`;
  if (updaterNotes.length > 1500) {
    updaterNotes = `${updaterNotes.slice(0, 1490)}\n…`;
  }
  return { url, section, bullets, notes, updaterNotes };
}

function loadChangelog(root) {
  return fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
}

module.exports = {
  REPO,
  changelogUrl,
  extractSection,
  extractBullets,
  releaseNotes,
  loadChangelog,
};

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const args = process.argv.slice(2).filter((arg) => arg !== "--updater");
  const updater = process.argv.includes("--updater");
  const version = args[0] || require(path.join(root, "package.json")).version;
  const result = releaseNotes({
    version,
    changelogMarkdown: loadChangelog(root),
  });
  process.stdout.write(`${updater ? result.updaterNotes : result.notes}\n`);
}
