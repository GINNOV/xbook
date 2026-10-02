import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

function readVersion(file: string) {
  try {
    const parsed = z.object({ version: z.string() }).safeParse(JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8")));
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}

export function GET() {
  const app = readVersion("package.json");
  const desktop = readVersion("src-tauri/tauri.conf.json") ?? readVersion("desktop-version.json");
  return NextResponse.json({
    app,
    desktop,
    match: Boolean(app && desktop && app === desktop),
    runtime: `node ${process.version}`,
    database: "sqlite",
    backend: { pid: process.pid, port: process.env.PORT ?? "3000", commit: process.env.XBOOK_BUILD_COMMIT ?? "unknown", startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), owner: process.env.XBOOK_BACKEND_OWNER ?? null },
  });
}
