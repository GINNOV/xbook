import { NextResponse } from "next/server";
import fs from "fs";
import { getDbPath } from "@/lib/db-backup";
import { createDatabaseExport } from "@/lib/db-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ ok: false, error: "Database file not found" }, { status: 404 });
    }

    const includeSecrets = new URL(request.url).searchParams.get("includeSecrets") === "true";
    const fileBuffer = await createDatabaseExport(dbPath, includeSecrets);
    
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="xbook-backup-${new Date().toISOString().slice(0, 10)}.db"`,
      },
    });
  } catch (error) {
    console.error("Backup download error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
