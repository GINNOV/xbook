import { describe, expect, it } from "vitest";
import { formatFolderActivity } from "@/app/lib/formatters";
import { toIsoDate } from "@/lib/folders";

describe("formatFolderActivity", () => {
  it("returns Never when missing or invalid", () => {
    expect(formatFolderActivity(null)).toBe("Never");
    expect(formatFolderActivity(undefined)).toBe("Never");
    expect(formatFolderActivity("not-a-date")).toBe("Never");
  });

  it("formats a valid timestamp", () => {
    const label = formatFolderActivity("2026-08-17T15:04:00.000Z");
    expect(label).not.toBe("Never");
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/Aug/);
  });
});

describe("toIsoDate", () => {
  it("normalizes Date and ISO string values", () => {
    const iso = "2026-08-17T15:04:00.000Z";
    expect(toIsoDate(iso)).toBe(iso);
    expect(toIsoDate(new Date(iso))).toBe(iso);
  });

  it("returns null for empty or invalid values", () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate("nope")).toBeNull();
  });
});
