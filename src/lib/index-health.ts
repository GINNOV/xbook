import type { Prisma, PrismaClient } from "@prisma/client";
import { bookmarkIndexState, type IndexState } from "./embedding-index";
import type { EmbeddingIdentity } from "./embedding-vector";

export async function getIndexHealth(db: PrismaClient | Prisma.TransactionClient, identity: Pick<EmbeddingIdentity, "model" | "endpoint"> | undefined, source?: string | null) {
  const rows = await db.bookmark.findMany({ where: { ...(source ? { source } : {}) } });
  const states: Record<IndexState, string[]> = { usable: [], missing: [], legacy: [], stale: [], incompatible: [], malformed: [] };
  for (const row of rows) {
    if (!row.summary?.trim()) continue;
    states[identity ? bookmarkIndexState(row, identity) : row.embedding ? "legacy" : "missing"].push(row.id);
  }
  return { states, total: rows.length, usable: states.usable.length,
    rebuildIds: [...states.missing, ...states.legacy, ...states.stale, ...states.incompatible, ...states.malformed],
    staleIds: [...states.legacy, ...states.stale, ...states.incompatible, ...states.malformed] };
}
