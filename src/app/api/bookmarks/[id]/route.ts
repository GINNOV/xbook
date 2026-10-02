import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bookmark = await prisma.bookmark.findUnique({ where: { id }, include: { folder: true } });
  if (!bookmark) return NextResponse.json({ ok: false, error: "Bookmark no longer exists." }, { status: 404 });
  return NextResponse.json({ ok: true, bookmark: { ...bookmark, folderName: bookmark.folder?.name ?? null, error: bookmark.enrichmentError } });
}
