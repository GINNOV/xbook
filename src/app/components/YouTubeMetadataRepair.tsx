"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
const resultSchema = z.object({
  ok: z.literal(true), afterId: z.string().nullable(), scanned: z.number(), updated: z.number(), requests: z.number(),
  status: z.enum(["completed", "paused"]), reason: z.string().optional(),
});
const explanations: Record<string, string> = {
  item_limit: "More saved videos remain. Continue to repair the next batch.",
  request_limit: "The request budget was reached. Continue to allow one more metadata request.",
  quota: "YouTube quota was reached. Continue after quota resets.",
  provider: "YouTube metadata could not be fetched. Check the YouTube connection in Settings before continuing.",
  changed: "A saved video changed during repair. Continue to use its current data.",
  stopped: "Repair stopped before the next change. Continue to resume.",
};
export default function YouTubeMetadataRepair() {
  const router = useRouter();
  const [result, setResult] = useState<z.infer<typeof resultSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [refreshMode, setRefreshMode] = useState<"missing" | "all">("missing");
  async function repair(afterId: string | null, refresh: "missing" | "all" = "missing") {
    setBusy(true); setError(null); setRefreshMode(refresh);
    try {
      const response = await fetch("/api/youtube/metadata/repair", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterId, maxItems: 50, maxRequests: remote ? 1 : 0, refresh }),
      });
      const body: unknown = await response.json();
      const parsed = resultSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        const failure = z.object({ error: z.string() }).safeParse(body);
        throw new Error(failure.success ? failure.data.error : "Metadata repair failed. Try again.");
      }
      setResult(parsed.data); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Metadata repair failed."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-slate-200 p-4 space-y-3" aria-label="Repair saved YouTube metadata">
    <h3 className="font-semibold">Repair saved video metadata</h3>
    <p className="text-sm text-slate-600">Correct creators and publication dates from saved metadata. Read state, manual digests and folder memberships are kept. You can run this again safely.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remote} disabled={busy} onChange={(event) => setRemote(event.target.checked)} />Allow one YouTube metadata request per batch to fill missing facts</label>
    <div className="flex flex-wrap gap-2">
      <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => void repair(null, "missing")}>{busy ? "Repairing…" : "Repair saved metadata"}</button>
      {result?.status === "paused" && <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => void repair(result.afterId, refreshMode)}>Continue metadata repair</button>}
      {remote && <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => void repair(null, "all")}>Refresh metadata from YouTube</button>}
    </div>
    {result && <div role="status" className="text-sm text-slate-600"><p>Last batch checked {result.scanned} videos and repaired {result.updated}. Metadata requests: {result.requests}.</p>
      <p>{result.status === "completed" ? "Metadata repair completed." : explanations[result.reason ?? ""] ?? "Continue to repair remaining metadata."}</p>
      {result.afterId && <p className="break-all text-xs">Resume cursor: {result.afterId}</p>}
      {!remote && result.status === "completed" && <p>Missing facts remain unknown. Enable a YouTube metadata request to fill them.</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
