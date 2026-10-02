import type { Prisma, PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { backfillYouTubeMetadata, createYouTubeMetadataProvider, type YouTubeMetadataProvider } from "./youtube-metadata-backfill";

const requestSchema = z.object({
  afterId: z.string().max(300).nullable().default(null),
  maxItems: z.number().int().min(1).max(50).default(50),
  maxRequests: z.number().int().min(0).max(1).default(0),
  refresh: z.enum(["missing", "all"]).default("missing"),
}).strict();
export class MetadataRepairConflictError extends Error {}

export function createYouTubeMetadataRepairHandler(input: {
  database: PrismaClient;
  getAccessToken: (signal: AbortSignal) => Promise<string>;
  createProvider?: (options: { accessToken: string; signal: AbortSignal }) => YouTubeMetadataProvider;
}) {
  return async (request: Request) => {
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ ok: false, error: "Expected a JSON metadata repair request." }, { status: 400 }); }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid metadata repair cursor or limits." }, { status: 400 });
    const options = parsed.data;
    const database = input.database;
    async function guard(tx: Prisma.TransactionClient) {
      await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
      if (await tx.operationRun.count({ where: { status: { in: ["queued", "running", "paused"] } } }) || await tx.importRun.count({ where: { finishedAt: null } })) {
        throw new MetadataRepairConflictError("Another operation owns the library. Finish or stop it before repairing metadata.");
      }
    }
    try {
      await database.$transaction(async (tx) => guard(tx));
      let provider: YouTubeMetadataProvider | undefined;
      if (options.maxRequests > 0) {
        provider = async (ids) => {
          const accessToken = await input.getAccessToken(request.signal);
          return (input.createProvider ?? createYouTubeMetadataProvider)({ accessToken, signal: request.signal })(ids);
        };
      }
      const result = await backfillYouTubeMetadata({ database, options, provider, signal: request.signal,
        commit: (args) => database.$transaction(async (tx) => {
          await guard(tx);
          if (request.signal.aborted) throw new Error("Metadata repair stopped.");
          const result = await tx.bookmark.updateMany(args);
          if (request.signal.aborted) throw new Error("Metadata repair stopped.");
          return result;
        }),
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof MetadataRepairConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
      if (request.signal.aborted) return NextResponse.json({ ok: false, error: "Metadata repair stopped. Retry safely from the last shown cursor." }, { status: 409 });
      return NextResponse.json({ ok: false, error: "Metadata repair failed. Retry safely from the last shown cursor." }, { status: 500 });
    }
  };
}
