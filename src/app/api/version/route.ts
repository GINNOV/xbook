import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function readVersion(file: string) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export function GET() {
  const app = readVersion("package.json");
  const desktop = readVersion("src-tauri/tauri.conf.json");
  return NextResponse.json({
    app,
    desktop,
    match: Boolean(app && desktop && app === desktop),
    runtime: `node ${process.version}`,
    database: "sqlite",
  });
}
