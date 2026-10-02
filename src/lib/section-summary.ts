/** Every retained section enters a bounded call; reduction never silently drops a suffix. */
export async function reduceSourceSections(input: {
  text: string; budget: number; signal?: AbortSignal;
  summarize: (section: string, position: number, total: number) => Promise<string>;
}) {
  if (input.budget < 256) throw new Error("The configured context window is too small for source processing. Increase it in AI settings.");
  let text = input.text;
  for (let round = 0; text.length > input.budget; round++) {
    if (round >= 8) throw new Error("Section summaries did not fit the configured context budget.");
    const sections: string[] = [];
    while (text.length) {
      let size = Math.min(input.budget, text.length);
      if (size < text.length) { const boundary = text.lastIndexOf(" ", size); if (boundary > size / 2) size = boundary; }
      sections.push(text.slice(0, size)); text = text.slice(size).trimStart();
    }
    const notes: string[] = [];
    for (const [index, section] of sections.entries()) {
      input.signal?.throwIfAborted();
      const note = (await input.summarize(section, index + 1, sections.length)).trim();
      if (!note || note.length > Math.floor(input.budget / 2)) throw new Error("A section summary exceeded its response budget. Reduce response tokens or increase the context window.");
      notes.push(note);
    }
    text = notes.join("\n");
  }
  return text;
}
