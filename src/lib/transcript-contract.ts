import { z } from "zod";

export const TRANSCRIPT_SECTION_CHARACTERS = 1500;
export const TRANSCRIPT_MAX_SECTIONS = 64;
export const transcriptSectionSchema = z.object({
  text: z.string().min(1).max(TRANSCRIPT_SECTION_CHARACTERS),
  startSeconds: z.number().finite().nonnegative().nullable(),
  endSeconds: z.number().finite().nonnegative().nullable(),
});
const captureFields = {
  language: z.string().nullable().optional(),
  capturedAt: z.string().datetime(),
  sections: z.array(transcriptSectionSchema).max(TRANSCRIPT_MAX_SECTIONS),
  totalCharacters: z.number().int().nonnegative(),
  storedCharacters: z.number().int().nonnegative(),
};
export const transcriptCaptureSchema = z.discriminatedUnion("status", [
  z.object({ ...captureFields, status: z.literal("complete"), reason: z.null() }),
  z.object({ ...captureFields, status: z.literal("partial"), reason: z.string().min(1) }),
  z.object({ ...captureFields, sections: z.array(transcriptSectionSchema).max(0), status: z.literal("missing"), reason: z.string().min(1) }),
]);
export type TranscriptSection = z.infer<typeof transcriptSectionSchema>;
export type TranscriptCapture = z.infer<typeof transcriptCaptureSchema>;

