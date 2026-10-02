import { NextResponse } from "next/server";
import fs from "fs";
import { getDbPath } from "@/lib/db-backup";
import { createDatabaseExport } from "@/lib/db-export";
import { getBackupDownloadFilename } from "@/lib/backup-download-name";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const searchParams = request?.url ? new URL(request.url).searchParams : new URLSearchParams();
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ ok: false, error: "Database file not found" }, { status: 404 });
    }

    const includeSecrets = searchParams.get("includeSecrets") === "true";
    const fileBuffer = await createDatabaseExport(dbPath, includeSecrets);
    const filename = getBackupDownloadFilename(searchParams.get("customName"));

    return new Response(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
