// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createDatabaseExport } from "@/lib/db-export";
import { GET } from "@/app/api/settings/database/backup/route";

vi.mock("@/lib/db-backup", () => ({ getDbPath: () => "/fixture.db" }));
vi.mock("fs", () => ({ default: { existsSync: () => true } }));
vi.mock("@/lib/db-export", () => ({ createDatabaseExport: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createDatabaseExport).mockResolvedValue(Buffer.from("snapshot"));
});

it.each(["", "?includeSecrets=false", "?includeSecrets=1", "?includeSecrets=TRUE"])(
  "excludes credentials unless the query explicitly opts in: %s",
  async (query) => {
    const response = await GET(new Request(`http://localhost/api/settings/database/backup${query}`));
    expect(createDatabaseExport).toHaveBeenCalledWith("/fixture.db", false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("snapshot");
  }
);

it("allows the explicit credential export option", async () => {
  await GET(new Request("http://localhost/api/settings/database/backup?includeSecrets=true"));
  expect(createDatabaseExport).toHaveBeenCalledWith("/fixture.db", true);
});
