import { z } from "zod";
import { OperationConflictError, readOperationJob, resumeOperationJob, stopOperationJob } from "@/lib/operation-job";
import { wakeOperationWorker } from "@/lib/operation-worker";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enrichmentSignals } from "@/lib/signals";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await prisma.operationRun.findUnique({
    where: { id },
    include: {
      events: {
        orderBy: { createdAt: "asc" },
        include: {
          bookmark: {
            select: {
              id: true,
              source: true,
              tweetUrl: true,
              text: true,
              summary: true,
              category: true,
              tags: true,
              authorUsername: true,
              folder: { select: { id: true, name: true } },
            },
          },
        },
      },
      llmRequests: {
        orderBy: { createdAt: "asc" },
        include: {
          bookmark: {
            select: {
              id: true,
              source: true,
              tweetUrl: true,
              text: true,
              summary: true,
              category: true,
              tags: true,
              authorUsername: true,
              folder: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!run) {
    return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, run });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await prisma.operationRun.findUnique({ where: { id } });

  if (!run) {
    return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
  }

  const text = await request.text();
  let body: unknown = {};
  try { if (text) body = JSON.parse(text); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const parsed = z.object({ action: z.enum(["stop", "resume"]).default("stop") }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Unknown operation action" }, { status: 400 });
  if (parsed.data.action === "resume") {
    if (!readOperationJob(run)) return NextResponse.json({ ok: false, error: "This older operation cannot resume. Start a new operation." }, { status: 409 });
    try {
      const updated = await resumeOperationJob(prisma, id);
      wakeOperationWorker();
      return NextResponse.json({ ok: true, run: updated });
    } catch (error) {
      if (error instanceof OperationConflictError) return NextResponse.json({ ok: false, runId: id, conflictingRunId: error.runId, error: error.message }, { status: 409 });
      throw error;
    }
  }
  const updated = await stopOperationJob(prisma, id, enrichmentSignals);
  return NextResponse.json({ ok: true, run: updated });
}
