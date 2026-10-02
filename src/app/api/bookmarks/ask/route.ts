import { NextResponse } from "next/server";
import { z } from "zod";
import type { Bookmark } from "@prisma/client";
import { searchQuestionEvidence, searchBookmarksSemantically } from "@/lib/bookmarks";
import { answerLibraryQuestion } from "@/lib/llm";
import { ASK_EVIDENCE_CHARACTERS, ASK_TOTAL_EVIDENCE_CHARACTERS, readSourceEvidence, selectQuestionEvidence } from "@/lib/source-evidence";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  source: z.enum(["x", "yt"]).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Provide a non-empty question." },
        { status: 400 }
      );
    }

    const question = parsed.data.question.trim();
    const source = parsed.data.source || undefined;

    let semanticError: string | null = null;
    let candidates: Array<Pick<Bookmark, "id" | "source" | "tweetUrl" | "summary" | "text" | "category" | "authorUsername" | "rawJson" | "captureJson"> & { similarity?: number }> = [];
    try { candidates = await searchBookmarksSemantically(question, { source }, request.signal); }
    catch (error) { semanticError = error instanceof Error ? error.message : "Semantic search unavailable. Check embedding settings."; }
    const keyword = await searchQuestionEvidence(question, { source });
    const keywordIds = new Set(keyword.slice(0, 4).map((item) => item.id));
    candidates = [...keyword.slice(0, 4).map((item) => ({ ...item, similarity: candidates.find((entry) => entry.id === item.id)?.similarity })),
      ...candidates.filter((item) => !keywordIds.has(item.id))];
    if (!candidates.length) return NextResponse.json({ ok: true, answer: "Insufficient evidence. No saved item in this scope contains support for that question.", citations: [], matches: [], semanticError });
    const retrieved = candidates.slice(0, 12);
    const evidenceBudget = Math.min(ASK_EVIDENCE_CHARACTERS, Math.floor(ASK_TOTAL_EVIDENCE_CHARACTERS / Math.max(1, retrieved.length)));
    const top = retrieved.map((b) => {
      const evidence = readSourceEvidence(b.rawJson, b.captureJson);
      return {
        id: b.id,
        source: b.source,
        tweetUrl: b.tweetUrl,
        summary: b.summary,
        text: b.text,
        category: b.category,
        authorUsername: b.authorUsername,
        similarity: b.similarity,
        ...((b.source === "yt" || evidence) ? {
          sourceEvidence: selectQuestionEvidence(b.rawJson, question, evidenceBudget, b.captureJson),
          captureStatus: evidence?.capture.status ?? "missing",
          captureReason: evidence?.capture.reason ?? (evidence ? null : "Transcript evidence has not been captured."),
        } : {}),
      };
    });

    const result = await answerLibraryQuestion({ question, candidates: top, signal: request.signal });

    const byId = new Map(top.map((c) => [c.id, c]));
    const cited = result.citations
      .map((c) => {
        const hit = byId.get(c.id);
        if (!hit) return null;
        return {
          id: hit.id,
          reason: c.reason,
          source: hit.source,
          tweetUrl: hit.tweetUrl,
          summary: hit.summary,
          text: hit.text,
          category: hit.category,
          authorUsername: hit.authorUsername,
          similarity: hit.similarity,
          excerpt: c.quote ?? hit.sourceEvidence?.[0]?.text ?? hit.text?.slice(0, 800) ?? null,
          timestampSeconds: (c.quote ? hit.sourceEvidence?.find((section) => section.text.includes(c.quote ?? "")) : hit.sourceEvidence?.[0])?.startSeconds ?? null,
          captureStatus: hit.captureStatus ?? null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      answer: result.answer,
      citations: cited,
      // Also return ranked retrieval if the model cited nothing useful.
      matches: top,
      semanticError,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Ask failed",
      },
      { status: 500 }
    );
  }
}
