import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
const url = process.env.XBOOK_E2E_DATABASE_URL;
if (!url) throw new Error("Disposable database required");
const database = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
let provider: Server; let origin: string; let failTranslation = false; let embeddings = 0; let chat = 0;
const proof = "Reader fixture evidence confirms the orchid remains blue.";
const capture = JSON.stringify({ version: 2, method: "transcript", language: "en", sourceUrls: ["https://www.youtube.com/watch?v=reader"], capture: { status: "partial", reason: "Fixture includes saved passages only", capturedAt: "2026-10-02T00:00:00.000Z", sections: [{ text: proof, startSeconds: 123, endSeconds: 130 }], totalCharacters: 5000, storedCharacters: proof.length } });
test.beforeAll(async () => {
  provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString(); response.setHeader("Content-Type", "application/json");
    if (request.url?.endsWith("/bookmarks/folders")) { response.end(JSON.stringify({ data: [] })); return; }
    if (request.url?.includes("/bookmarks")) { response.end(JSON.stringify({ data: [{ id: "r9-reader-import", text: proof }] })); return; }
    if (request.url?.endsWith("/models")) { response.end(JSON.stringify({ data: [{ id: "reader-chat" }, { id: "reader-embed" }] })); return; }
    if (request.url?.endsWith("/embeddings")) { embeddings++; response.end(JSON.stringify({ data: [{ index: 0, embedding: Buffer.from(new Float32Array([1, 0]).buffer).toString("base64") }], model: "reader-embed", usage: { prompt_tokens: 1, total_tokens: 1 } })); return; }
    if (request.url?.endsWith("/users/me")) { response.end(JSON.stringify({ data: { id: "fixture-user" } })); return; }
    if (!request.url?.endsWith("/chat/completions")) { response.writeHead(404); response.end(JSON.stringify({ error: "Unexpected fixture route" })); return; }
    chat++;
    if (body.includes("professional translator") && failTranslation) { response.writeHead(503); response.end(JSON.stringify({ error: { message: "Fixture translation offline" } })); return; }
    const content = body.includes("CANDIDATES:") ? JSON.stringify({ answer: "The orchid remains blue.", citations: [{ id: "r9-reader-a", reason: "Saved post evidence", quote: proof }] }) : body.includes("professional translator") ? "Saved translated orchid" : JSON.stringify({ summary: "Reader generated digest", category: "Reader", tags: ["orchid"] });
    response.end(JSON.stringify({ id: "reader-response", object: "chat.completion", model: "reader-chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve)); const address = provider.address(); if (!address || typeof address === "string") throw new Error("Provider missing"); origin = `http://127.0.0.1:${address.port}/v1`;
});
test.beforeEach(async () => {
  failTranslation = false; embeddings = 0; chat = 0;
  const settings = { llmBaseUrl: origin, llmModel: "reader-chat", llmEmbeddingBaseUrl: origin, llmEmbeddingModel: "reader-embed", llmConcurrency: 1, xAccessToken: "fixture-token", xUserId: "fixture-user", xApiBase: origin.replace("/v1", "/2"), monthlyCap: 100 };
  await database.settings.upsert({ where: { id: "default" }, create: { id: "default", ...settings }, update: settings });
  await database.bookmark.createMany({ data: [{ id: "r9-reader-a", source: "x", tweetUrl: "https://x.com/fixture/status/1", text: proof, summary: "Reader first summary", category: "Reader", enrichmentError: "Prior failure", enrichmentFailures: 3, editedAt: new Date(), readAt: new Date() }, { id: "r9-reader-b", source: "yt", tweetUrl: "https://www.youtube.com/watch?v=reader", text: "Reader video\nSaved description", summary: "Reader video digest", captureJson: capture, rawJson: JSON.stringify({ item: { snippet: { title: "Reader video" } } }) }] });
});
test.afterEach(async () => { await database.operationRun.updateMany({ where: { status: { in: ["running", "queued", "paused"] } }, data: { status: "stopped", cancelRequestedAt: new Date(), leaseOwner: null, leaseUntil: null, revision: { increment: 1 } } }); await database.processingEvent.deleteMany({ where: { bookmarkId: { startsWith: "r9-reader-" } } }); await database.bookmark.deleteMany({ where: { id: { startsWith: "r9-reader-" } } }); });
test.afterAll(async () => { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); await database.$disconnect(); });
for (const width of [390, 900]) test(`reader and editor preserve focus and separate state at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/bookmarks?source=x&sort=posted&dir=asc");
  const opener = page.getByRole("button", { name: "Read bookmark: Reader first summary" }); await opener.focus(); await page.keyboard.press("Enter");
  const reader = page.getByRole("dialog", { name: "Bookmark reader" }); await expect(reader).toBeVisible();
  expect(await reader.boundingBox()).toMatchObject({ width: Math.min(width, 440) });
  await expect(reader.getByText("Blocked", { exact: false })).toBeVisible(); await expect(reader.getByText("Summary source: Human correction.", { exact: true })).toBeVisible();
  await reader.getByRole("button", { name: "Edit enrichment", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit enrichment", exact: true }); await expect(editor.getByLabel("Summary", { exact: true })).toBeFocused();
  await editor.getByLabel("Summary", { exact: true }).fill("Unsaved draft"); await page.keyboard.press("Escape"); await expect(editor).toHaveCount(0); await expect(reader.getByRole("button", { name: "Edit enrichment", exact: true })).toBeFocused();
  await page.screenshot({ path: `docs/repair-evidence/r9-reader-${width}.png`, fullPage: true });
  await page.keyboard.press("Escape"); await expect(reader).toHaveCount(0); await expect(opener).toBeFocused(); expect(page.url()).toContain("sort=posted&dir=asc"); expect(errors).toEqual([]);
});
test("single enrichment, saved capture and Ask use actual local HTTP providers", async ({ page }) => {
  test.setTimeout(65000);
  await page.setViewportSize({ width: 900, height: 850 });
  await database.bookmark.update({ where: { id: "r9-reader-a" }, data: { editedAt: null, enrichmentError: null, enrichmentFailures: 0 } });
  await page.goto("/bookmarks?source=x"); await page.getByRole("button", { name: "Read bookmark: Reader first summary" }).click();
  const reader = page.getByRole("dialog", { name: "Bookmark reader" }); await reader.getByRole("button", { name: "Reprocess with LLM" }).click();
  await expect(reader.getByText("Reader generated digest", { exact: true })).toBeVisible({ timeout: 30000 }); expect(embeddings).toBe(1); expect(chat).toBe(1);
  const indexed = await database.bookmark.findUniqueOrThrow({ where: { id: "r9-reader-a" } }); expect(indexed.embeddingModel).toBe("reader-embed"); expect(indexed.embedding).not.toBeNull();
  await reader.getByRole("button", { name: "Translate", exact: true }).click(); await expect(reader.getByText("Saved translated orchid", { exact: true })).toBeVisible();
  failTranslation = true; await reader.getByRole("button", { name: "Translate", exact: true }).click(); await expect(page.getByRole("button", { name: "Retry translation" })).toBeVisible(); await expect(reader.getByText("Saved translated orchid", { exact: true })).toBeVisible();
  failTranslation = false; await page.getByRole("button", { name: "Retry translation" }).click(); await expect(page.getByRole("button", { name: "Retry translation" })).toHaveCount(0);
  await reader.getByRole("button", { name: "Close reader" }).click();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click(); await page.locator('input[name="q"]').fill("What color is the orchid?"); await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("The orchid remains blue.", { exact: true })).toBeVisible(); await expect(page.getByText(proof, { exact: true })).toBeVisible();
  await page.goto("/bookmarks?source=yt"); await page.getByRole("button", { name: "Read bookmark: Reader video", exact: true }).click(); const video = page.getByRole("dialog", { name: "Bookmark reader" }); await video.getByText("Captured source passages", { exact: true }).click(); await expect(video.getByRole("link", { name: "2:03" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=reader&t=123"); await expect(video.getByText(/Fixture includes saved passages only/)).toBeVisible();
});

test("Process inbox imports then summarizes and indexes each entry once", async ({ page }) => {
  await page.goto("/?source=x");
  const acknowledgment = page.waitForResponse(response => response.url().includes("/api/import?") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Process inbox", exact: true }).click();
  const submitted = await acknowledgment; expect(submitted.status()).toBe(202); const { runId } = await submitted.json();
  await expect.poll(async () => ["completed", "partial", "failed"].includes((await database.operationRun.findUnique({ where: { id: runId } }))?.status ?? ""), { timeout: 20000 }).toBe(true);
  const completed = await database.operationRun.findUniqueOrThrow({ where: { id: runId } }); expect(completed.status, completed.jobJson ?? "missing checkpoint").toBe("completed");
  expect(embeddings).toBe(1); expect(chat).toBe(1);
  const row = await database.bookmark.findUniqueOrThrow({ where: { id: "r9-reader-import" } }); expect(row.summary).toBe("Reader generated digest"); expect(row.embeddingModel).toBe("reader-embed"); expect(row.captureJson).toContain(proof);
});
