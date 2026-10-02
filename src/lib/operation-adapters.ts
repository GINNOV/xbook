import { z } from "zod";
import { prisma } from "./db";
import { contentSnapshot, saveEmbeddingIfUnchanged, saveEnrichmentIfUnchanged } from "./embedding-index";
import { captureBookmarkSourceEvidence } from "./source-evidence";
import { generateEmbeddingResult, llmConnectionSchema, summarizeBookmark, validateLlmConnection } from "./llm";
import type { JobAdapter, OperationJob } from "./operation-job";

export const operationSettingsSchema = z.object({
  chat: llmConnectionSchema.optional(),
  embedding: z.object({ model: z.string(), endpoint: z.string().url() }).optional(),
  concurrency: z.number().int().min(1).max(32).default(1),
  batchSize: z.number().int().min(1).max(10000).default(50),
});

async function sourceText(urls: string[], signal: AbortSignal) {
  const captures: string[] = [];
  for (const value of urls.slice(0, 2)) {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || /(^|\.)(x\.com|twitter\.com|t\.co)$/.test(url.hostname)) continue;
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) continue;
      captures.push((await response.text()).replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000));
    } catch { if (signal.aborted) throw new Error("Operation aborted"); }
  }
  return captures.join("\n---\n") || undefined;
}

export function operationAdapter(job: OperationJob): JobAdapter {
  const settings = operationSettingsSchema.parse(job.settings);
  if (job.kind === "embedding") return {
    preflight: async () => { if (!settings.embedding?.model) throw new Error("Missing embedding model. Select an embedding model in AI settings."); },
    execute: async (id, _job, signal) => {
      const bookmark = await prisma.bookmark.findUnique({ where: { id } });
      if (!bookmark?.summary?.trim()) return async () => "skipped";
      const generated = await generateEmbeddingResult(`${bookmark.summary}\n${bookmark.category ?? ""}\n${bookmark.tags ?? ""}`, signal, settings.embedding);
      return async (tx) => await saveEmbeddingIfUnchanged(tx, { id, snapshot: contentSnapshot(bookmark), embedding: Buffer.from(new Float32Array(generated.vector).buffer), identity: generated.identity }) ? "updated" : "skipped";
    },
  };
  return {
    preflight: async (_job, signal) => {
      if (!settings.chat) throw new Error("Missing chat configuration");
      await validateLlmConnection(signal, settings.chat);
    },
    execute: async (id, operation, signal, runId, persistPreparation) => {
      const bookmark = await prisma.bookmark.findUnique({ where: { id }, include: { folder: true } });
      if (!bookmark || (bookmark.editedAt && !operation.scope.replaceEdited)) return async () => "skipped";
      let captured: Awaited<ReturnType<typeof captureBookmarkSourceEvidence>> | undefined;
      let linkedText: string | undefined;
      let urls: string[] = [];
      try { const parsed = z.array(z.string()).safeParse(JSON.parse(bookmark.externalUrls ?? "[]")); if (parsed.success) urls = parsed.data; } catch { /* Older malformed provider URLs. */ }
      if (bookmark.source === "yt") {
        captured = await captureBookmarkSourceEvidence(bookmark, signal);
        linkedText = captured.sourceText;
        const rawJson = captured.rawJson;
        if (persistPreparation && !await persistPreparation(async (tx) => {
          await tx.bookmark.updateMany({ where: { id, rawJson: bookmark.rawJson }, data: { rawJson } });
        })) throw new Error("Operation ownership lost during capture");
      } else linkedText = await sourceText(urls, signal);
      const enrichment = await summarizeBookmark({ text: bookmark.source === "yt" && linkedText ? undefined : bookmark.text ?? undefined,
        authorUsername: bookmark.authorUsername ?? undefined, folderName: bookmark.folder?.name ?? undefined, mediaDescription: bookmark.mediaDescription ?? undefined,
        externalUrls: urls, sourceText: linkedText, signal, connection: settings.chat, embeddingConnection: settings.embedding, processing: { runId, bookmarkId: id } });
      return async (tx) => {
        const saved = await saveEnrichmentIfUnchanged(tx, { id, snapshot: contentSnapshot(bookmark),
          content: { summary: enrichment.summary, category: enrichment.category ?? null, tags: enrichment.tags?.join(", ") ?? null },
          embedding: enrichment.embedding, embeddingIdentity: enrichment.embeddingIdentity });
        if (saved && captured) await tx.bookmark.updateMany({ where: { id, rawJson: bookmark.rawJson }, data: { rawJson: captured.rawJson } });
        return saved ? "updated" : "skipped";
      };
    },
  };
}
