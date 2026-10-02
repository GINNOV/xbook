import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const databaseUrl = process.env.XBOOK_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing disposable E2E database");
const database = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
const prefix = "r6-metadata-";
const folderId = "yt:pl:r6-metadata";
const publication = new Date("2024-01-02T12:00:00Z");
const addition = new Date("2025-05-01T12:00:00Z");
let previousToken: string | null = null;

test.beforeAll(async () => {
  previousToken = (await database.settings.findUnique({ where: { id: "default" } }))?.ytAccessToken ?? null;
  await database.settings.upsert({ where: { id: "default" }, create: { id: "default" }, update: { ytAccessToken: null } });
  await database.bookmarkFolder.create({ data: { id: folderId, name: "Metadata repair fixture" } });
  await database.bookmark.createMany({ data: Array.from({ length: 55 }, (_, index) => {
    const id = `${prefix}${String(index).padStart(3, "0")}`;
    return { id, source: "yt", tweetUrl: `https://www.youtube.com/watch?v=${id}`, folderId,
      text: `Fixture source ${index}`, authorName: "Wrong playlist owner", createdAt: addition,
      summary: "Preserved human correction", editedAt: publication, readAt: publication, captureJson: JSON.stringify({ captured: "Prior source" }),
      rawJson: JSON.stringify({ playlistId: "r6-metadata", item: { snippet: { title: `Video ${index}`, videoOwnerChannelTitle: `Creator ${index}`,
        videoOwnerChannelId: `channel-${index}`, publishedAt: addition.toISOString(), resourceId: { videoId: id } }, contentDetails: { videoPublishedAt: publication.toISOString() } } }),
    };
  }) });
});
test.afterAll(async () => {
  await database.operationRun.deleteMany({ where: { id: "r6-metadata-conflict" } });
  await database.bookmark.deleteMany({ where: { id: { startsWith: prefix } } });
  await database.bookmarkFolder.delete({ where: { id: folderId } });
  await database.settings.update({ where: { id: "default" }, data: { ytAccessToken: previousToken } });
  await database.$disconnect();
});

test("repairs historical metadata through bounded batches and preserves existing user data", async ({ page }) => {
  await page.goto("/folders?tab=yt");
  const controls = page.getByRole("region", { name: "Repair saved YouTube metadata" });
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("checkbox")).not.toBeChecked();
  await controls.getByRole("button", { name: "Repair saved metadata", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Continue metadata repair" })).toBeVisible();
  await expect(controls.getByRole("status")).toContainText("Metadata requests: 0.");
  await controls.getByRole("button", { name: "Continue metadata repair" }).click();
  await expect(controls.getByRole("status")).toContainText("Metadata repair completed.");
  const first = await database.bookmark.findUniqueOrThrow({ where: { id: `${prefix}000` } });
  expect(first).toMatchObject({ authorName: "Creator 0", uploaderChannelId: "channel-0", createdAt: publication, playlistAddedAt: addition,
    summary: "Preserved human correction", editedAt: publication, readAt: publication, folderId, captureJson: JSON.stringify({ captured: "Prior source" }) });
  expect(await database.bookmark.count({ where: { id: { startsWith: prefix }, authorName: "Wrong playlist owner" } })).toBe(0);
  await controls.getByRole("button", { name: "Repair saved metadata", exact: true }).click();
  await expect(controls.getByRole("status")).toContainText("repaired 0.");
  await controls.getByRole("button", { name: "Continue metadata repair" }).click();
  await expect(controls.getByRole("status")).toContainText("Metadata repair completed.");
  await page.screenshot({ path: "docs/repair-evidence/r6-metadata-repair.png", fullPage: true });
});

test("explains active ownership rejection without changing metadata", async ({ page }) => {
  await database.operationRun.create({ data: { id: "r6-metadata-conflict", type: "fixture", status: "paused" } });
  await page.goto("/folders?tab=yt");
  const controls = page.getByRole("region", { name: "Repair saved YouTube metadata" });
  await controls.getByRole("button", { name: "Repair saved metadata", exact: true }).click();
  await expect(controls.getByRole("alert")).toContainText("Another operation owns the library");
  await database.operationRun.delete({ where: { id: "r6-metadata-conflict" } });
});
