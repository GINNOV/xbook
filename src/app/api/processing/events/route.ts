import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
const serialize = (value: unknown) => JSON.stringify(value, (key, item) => key === "jobJson" ? undefined : item);

/** Database snapshots make reconnects and workers in other processes observable. */
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let reading = false;
  let previous = "";
  const stream = new ReadableStream({
    start(controller) {
      async function snapshot() {
        if (closed || reading) return;
        reading = true;
        try {
          const runs = await prisma.operationRun.findMany({ orderBy: { startedAt: "desc" }, take: 50, include: { _count: { select: { events: true, llmRequests: true } } } });
          const serialized = serialize(runs);
          if (serialized !== previous) {
            previous = serialized;
            for (const run of runs) controller.enqueue(encoder.encode(`event: run_updated\ndata: ${serialize(run)}\n\n`));
          } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { /* The next snapshot reconciles after maintenance or reconnect. */ }
        finally { reading = false; }
      }
      void snapshot();
      timer = setInterval(() => { void snapshot(); }, 1000);
      request.signal.addEventListener("abort", () => { closed = true; if (timer) clearInterval(timer); try { controller.close(); } catch { /* Already disconnected. */ } }, { once: true });
    },
    cancel() { closed = true; if (timer) clearInterval(timer); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
