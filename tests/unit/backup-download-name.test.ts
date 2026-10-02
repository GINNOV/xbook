import { afterEach, describe, expect, it, vi } from "vitest";
import { getBackupDownloadFilename } from "@/lib/backup-download-name";

afterEach(() => vi.useRealTimers());

describe("backup download filenames", () => {
  it.each([
    ["before_enrichment", "before_enrichment.db"],
    ["  My backup  ", "My_backup.db"],
    ["backup.db", "backup.db"],
    ["backup.DB", "backup.db"],
    ["backup.sqlite", "backup.db"],
    ["backup.SQLITE.db", "backup.db"],
    ["backup.db.db", "backup.db"],
    ["../../private\\backup", "______private_backup.db"],
    ["report\"\r\nX-Evil: yes", "report___X-Evil__yes.db"],
    ["backup & notes?#", "backup___notes__.db"],
    ["café", "caf_.db"],
    ["a".repeat(200) + ".db", "a".repeat(120) + ".db"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(getBackupDownloadFilename(input)).toBe(expected);
  });

  it.each([null, "", "   ", ".db", ".sqlite", "../\\", "\r\n\"", "💾"])(
    "uses the dated default for an unusable name %j",
    (input) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
      expect(getBackupDownloadFilename(input)).toBe("xbook-backup-2026-09-18.db");
    },
  );
});
