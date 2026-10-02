import { z } from "zod";
import { transcriptCaptureSchema } from "./transcript-contract";

export const capturedSourceSchema = z.object({
  version: z.literal(2), method: z.enum(["transcript", "article", "description", "post", "missing"]),
  language: z.string().nullable(), sourceUrls: z.array(z.string()), capture: transcriptCaptureSchema,
});
export type CapturedSource = z.infer<typeof capturedSourceSchema>;
export function readCapturedSource(captureJson: string | null | undefined): CapturedSource | null {
  if (!captureJson) return null;
  try { const parsed = capturedSourceSchema.safeParse(JSON.parse(captureJson)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
