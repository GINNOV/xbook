export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startOperationWorker } = await import("./lib/operation-worker");
    await startOperationWorker();
  }
}
