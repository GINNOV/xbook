import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "node:os";
import { DatabaseMaintenanceError } from "@/lib/database-maintenance";
import { InvalidRestoreError } from "@/lib/restore-validation";
import { z } from "zod";
import { restoreBackup, getBackupDir } from "@/lib/db-backup";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      // 1. Restore from file upload
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      // Validate SQLite file header: The first 16 bytes must be "SQLite format 3\0"
      const expectedHeader = "SQLite format 3\0";
      if (buffer.length < 16) {
        return NextResponse.json(
          { ok: false, error: "Invalid file. File is too small to be a SQLite database." },
          { status: 400 }
        );
      }
      
      const fileHeader = buffer.toString("utf8", 0, 16);
      if (fileHeader !== expectedHeader) {
        return NextResponse.json(
          { ok: false, error: "Invalid file format. Please upload a valid SQLite database." },
          { status: 400 }
        );
      }

      // Use a private temporary upload directory.
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-upload-"));
      const tempPath = path.join(temporaryDirectory, "candidate.db");
      fs.writeFileSync(tempPath, buffer, { mode: 0o600 });

      try {
        await restoreBackup(tempPath);
      } finally {
        // Clean up temp file
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      }

      return NextResponse.json({ ok: true, message: "Database successfully restored from uploaded file" });
    } else if (contentType.includes("application/json")) {
      // 2. Restore from server backup
      const body = await request.json().catch(() => ({}));
      const parsed = z.object({ filename: z.string().min(1) }).safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ ok: false, error: "Filename is required" }, { status: 400 });
      }

      const { filename } = parsed.data;
      const backupDir = getBackupDir();
      const backupPath = path.join(backupDir, filename);

      // Security traversal check
      const relative = path.relative(backupDir, backupPath);
      if (path.basename(filename) !== filename || relative.startsWith("..") || path.isAbsolute(relative)) {
        return NextResponse.json({ ok: false, error: "Invalid backup file path" }, { status: 400 });
      }

      if (!fs.existsSync(backupPath)) {
        return NextResponse.json({ ok: false, error: "Backup file not found on server" }, { status: 404 });
      }

      const canonicalBackupDir = fs.realpathSync(backupDir);
      if (path.dirname(fs.realpathSync(backupPath)) !== canonicalBackupDir) {
        return NextResponse.json({ ok: false, error: "Invalid backup file path" }, { status: 400 });
      }
      await restoreBackup(backupPath);
      return NextResponse.json({ ok: true, message: `Database successfully restored from local backup: ${filename}` });
    } else {
      return NextResponse.json({ ok: false, error: "Unsupported content type" }, { status: 400 });
    }
  } catch (error) {
    console.error("Database restore error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof DatabaseMaintenanceError ? 409 : error instanceof InvalidRestoreError ? 400 : 500 }
    );
  }
}
