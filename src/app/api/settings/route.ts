import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, updateSettings } from "@/lib/settings";
import { MAX_LLM_CONCURRENCY } from "@/lib/llm-limits";
import { prisma } from "@/lib/db";
import { modelEndpointSchema } from "@/lib/connection-diagnostics";

const schema = z.object({
  xBearerToken: z.string().optional().nullable(),
  xUserId: z.string().optional().nullable(),
  xApiBase: z.string().optional().nullable(),
  xClientId: z.string().optional().nullable(),
  xClientSecret: z.string().optional().nullable(),
  xRedirectUri: z.string().optional().nullable(),
  xAccessToken: z.string().optional().nullable(),
  xRefreshToken: z.string().optional().nullable(),
  xTokenExpiresAt: z.iso.datetime().optional().nullable(),
  xScope: z.string().optional().nullable(),
  xTokenType: z.string().optional().nullable(),
  ytClientId: z.string().optional().nullable(),
  ytClientSecret: z.string().optional().nullable(),
  ytRedirectUri: z.string().optional().nullable(),
  ytAccessToken: z.string().optional().nullable(),
  ytRefreshToken: z.string().optional().nullable(),
  ytTokenExpiresAt: z.iso.datetime().optional().nullable(),
  ytScope: z.string().optional().nullable(),
  ytTokenType: z.string().optional().nullable(),
  llmBaseUrl: z.union([modelEndpointSchema, z.literal("")]).optional().nullable(),
  llmApiKey: z.string().optional().nullable(),
  llmModel: z.string().optional().nullable(),
  llmEmbeddingModel: z.string().optional().nullable(),
  llmEmbeddingBaseUrl: z.union([modelEndpointSchema, z.literal("")]).optional().nullable(),
  llmSystemPrompt: z.string().optional().nullable(),
  llmPrompt: z.string().optional().nullable(),
  llmConcurrency: z.coerce.number().int().min(1).max(MAX_LLM_CONCURRENCY).optional(),
  llmMaxTokens: z.coerce.number().int().min(1).max(512000).optional(),
  llmContextWindow: z.coerce.number().int().min(1).max(1000000).optional(),
  llmResponseLimit: z.coerce.number().int().min(0).max(128000).optional(),
  llmThinkingEnabled: z.boolean().optional().nullable(),
  monthlyCap: z.coerce.number().int().min(1).max(10000).optional(),
  ytMonthlyCap: z.coerce.number().int().min(1).max(10000).optional(),
  enrichBatchSize: z.coerce.number().int().min(1).max(200).optional(),
  targetLanguage: z.string().optional().nullable(),
  logLlmPayloads: z.boolean().optional().nullable(),
  soundOnComplete: z.boolean().optional().nullable(),
  soundOnError: z.boolean().optional().nullable(),
  lastBookmarkId: z.string().optional().nullable(),
});

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    ok: true,
    settings,
  });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues[0]?.message || "Validation failed";
    const path = parsed.error.issues[0]?.path.join(".");
    return NextResponse.json(
      { ok: false, error: `${path}: ${error}` },
      { status: 400 }
    );
  }

  const { xTokenExpiresAt, ytTokenExpiresAt, ...values } = parsed.data;
  const payload = {
    ...values,
    ...(xTokenExpiresAt !== undefined ? { xTokenExpiresAt: xTokenExpiresAt ? new Date(xTokenExpiresAt) : null } : {}),
    ...(ytTokenExpiresAt !== undefined ? { ytTokenExpiresAt: ytTokenExpiresAt ? new Date(ytTokenExpiresAt) : null } : {}),
  };

  try {
    const disconnected = (key: "xAccessToken" | "xRefreshToken" | "ytAccessToken" | "ytRefreshToken") => parsed.data[key] !== undefined && !parsed.data[key]?.trim();
    const prefixes = [
      ...(disconnected("xAccessToken") || disconnected("xRefreshToken") ? ["x:"] : []),
      ...(disconnected("ytAccessToken") || disconnected("ytRefreshToken") ? ["yt:"] : []),
    ];
    const updated = prefixes.length ? await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Settings" SET "id" = "id" WHERE 0`;
      await tx.oAuthSession.deleteMany({ where: { OR: prefixes.map((prefix) => ({ state: { startsWith: prefix } })) } });
      return updateSettings(payload, tx);
    }) : await updateSettings(payload);
    return NextResponse.json({ ok: true, settings: updated });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Settings could not be saved. Retry after checking database availability." },
      { status: 500 }
    );
  }
}
