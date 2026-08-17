import { describe, expect, it } from "vitest";
import {
  changelogUrl,
  extractSection,
  releaseNotes,
} from "../../scripts/changelog-notes.js";

const sample = `# Changelog

## [Unreleased]

- Upcoming.

## [0.4.2] - 2026-08-17

### Fixed

- Desktop links open in the system browser.

### Changed

- YouTube Settings shows a connected banner.

## [0.4.1] - 2026-08-17

### Fixed

- Desktop production build no longer type-checks the trailer.
`;

describe("changelog-notes", () => {
  it("points at the tagged CHANGELOG, not a bare filename", () => {
    expect(changelogUrl("0.4.2")).toBe(
      "https://github.com/GINNOV/xbook/blame/xbook-v0.4.2/CHANGELOG.md",
    );
  });

  it("extracts only the requested version section", () => {
    const section = extractSection(sample, "0.4.2");
    expect(section).toContain("Desktop links open in the system browser.");
    expect(section).not.toContain("Upcoming.");
    expect(section).not.toContain("0.4.1");
  });

  it("writes a short summary plus a markdown changelog link", () => {
    const { notes, url } = releaseNotes({ version: "0.4.2", changelogMarkdown: sample });
    expect(notes).toContain("- Desktop links open in the system browser.");
    expect(notes).toContain("- YouTube Settings shows a connected banner.");
    expect(notes).not.toContain("### Fixed");
    expect(notes).not.toContain("Upcoming.");
    expect(notes).toContain(`Details: [changelog](${url})`);
    expect(notes).not.toMatch(/See CHANGELOG\.md(?!\))/);
  });

  it("keeps only the first sentence of a long changelog bullet", () => {
    const long = `## [1.0.0] - 2026-01-01

- YouTube Google sign-in always opens in the system browser. A stored loopback redirect on a dead port is rewritten to the live server origin.
`;
    const { notes } = releaseNotes({ version: "1.0.0", changelogMarkdown: long });
    expect(notes).toContain("- YouTube Google sign-in always opens in the system browser.");
    expect(notes).not.toContain("loopback");
  });

  it("includes the changelog URL in updater notes", () => {
    const { updaterNotes, url } = releaseNotes({
      version: "0.4.2",
      changelogMarkdown: sample,
    });
    expect(updaterNotes).toContain("- Desktop links open in the system browser.");
    expect(updaterNotes).toContain(url);
  });
});
