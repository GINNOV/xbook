export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumeInterruptedWork } = await import("@/lib/work-continuation");
  await resumeInterruptedWork().catch((error) => {
    console.error("Interrupted work was not resumed:", error);
  });
}
