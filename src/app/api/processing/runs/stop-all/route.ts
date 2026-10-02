import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enrichmentSignals } from "@/lib/signals";
export const dynamic = "force-dynamic";
export async function POST() {
  const updated = await prisma.operationRun.updateMany({ where: { status: { in: ["queued", "running", "paused"] } }, data: {
    status: "stopped", cancelRequestedAt: new Date(), finishedAt: new Date(), leaseOwner: null, leaseUntil: null, revision: { increment: 1 },
  } });
  await prisma.importRun.updateMany({ where: { finishedAt: null }, data: { finishedAt: new Date(), notes: "Import stopped by user." } });
  for (const controller of enrichmentSignals.values()) controller.abort();
  return NextResponse.json({ ok: true, stoppedCount: updated.count });
}
