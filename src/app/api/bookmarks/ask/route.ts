import { NextResponse } from "next/server";
import { z } from "zod";
import { getBookmarks, searchBookmarksSemantically } from "@/lib/bookmarks";
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
    let candidates: Awaited<ReturnType<typeof searchBookmarksSemantically>> = [];
    try {
      candidates = await searchBookmarksSemantically(question, { source });
    } catch (error) {
      semanticError = error instanceof Error ? error.message : "Semantic search is unavailable.";
    }
    const seen = new Set(candidates.map((item) => item.id));
    try {
      const keyword = await getBookmarks({
        query: question,
        source: source ?? "",
        match: "phrase",
        page: 1,
        pageSize: 8,
      });
      for (const item of keyword.bookmarks) {
        if (!seen.has(item.id)) candidates.push(item as (typeof candidates)[number]);
      }
    } catch (error) {
      if (!semanticError) {
        semanticError = error instanceof Error ? error.message : "Keyword search is unavailable.";
      }
    }
    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        answer: "Insufficient evidence. No saved item in this scope contains support for that question.",
        citations: [],
        matches: [],
        semanticError,
      });
    }
    const retrieved = candidates.slice(0, 12);
    const evidenceBudget = Math.min(ASK_EVIDENCE_CHARACTERS, Math.floor(ASK_TOTAL_EVIDENCE_CHARACTERS / Math.max(1, retrieved.length)));
    const top = retrieved.map((b) => {
      const evidence = b.source === "yt" ? readSourceEvidence(b.rawJson) : null;
      return {
        id: b.id,
        source: b.source,
        tweetUrl: b.tweetUrl,
        summary: b.summary,
        text: b.text,
        category: b.category,
        authorUsername: b.authorUsername,
        similarity: b.similarity,
        ...(b.source === "yt" ? {
          sourceEvidence: selectQuestionEvidence(b.rawJson, question, evidenceBudget),
          captureStatus: evidence?.capture.status ?? "missing",
          captureReason: evidence?.capture.reason ?? (evidence ? null : "Transcript evidence has not been captured."),
        } : {}),
      };
    });

    const result = await answerLibraryQuestion({ question, candidates: top });

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
          excerpt: hit.sourceEvidence?.[0]?.text ?? null,
          timestampSeconds: hit.sourceEvidence?.[0]?.startSeconds ?? null,
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
