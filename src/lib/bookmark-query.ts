import { z } from "zod";
import { normalizeBookmarkPagination } from "./bookmark-pagination";
import { parseBookmarkSort } from "./bookmark-sort";

const optionalText = (maximum: number) => z.preprocess(
  (value) => value === null || value === undefined ? "" : value,
  z.string().max(maximum),
);
const flag = z.preprocess(
  (value) => value === null || value === undefined || value === "" ? false : value === "true" ? true : value === "false" ? false : value,
  z.boolean(),
);
export const BOOKMARK_STATES = ["", "pending", "summarized", "unread", "failed", "blocked", "stale", "unindexed"] as const;
export const TEXT_MODES = ["substring", "phrase", "word"] as const;

/** Shared library/agent contract. Invalid pagination normalizes before a database fetch. */
export const bookmarkQuerySchema = z.object({
  query: optionalText(4000),
  source: optionalText(32),
  category: optionalText(1000),
  folderId: optionalText(1000),
  status: z.preprocess((value) => value ?? "", z.enum(BOOKMARK_STATES)),
  video: flag,
  semantic: flag,
  textMode: z.preprocess((value) => value === null || value === undefined || value === "" ? "substring" : value, z.enum(TEXT_MODES)),
  sort: z.preprocess((value) => typeof value === "string" ? value : undefined, z.string().optional()),
  dir: z.preprocess((value) => typeof value === "string" ? value : undefined, z.string().optional()),
  page: z.unknown().optional(),
  pageSize: z.unknown().optional(),
}).transform((input) => ({
  ...input,
  ...normalizeBookmarkPagination(input.page, input.pageSize),
  ...parseBookmarkSort(input.sort, input.dir, input.semantic && Boolean(input.query)),
}));

export type BookmarkQueryInput = Partial<z.input<typeof bookmarkQuerySchema>>;
export type BookmarkQuery = z.output<typeof bookmarkQuerySchema>;
export type BookmarkTextMode = BookmarkQuery["textMode"];
export type BookmarkSearchScope = Partial<Pick<BookmarkQuery, "source" | "category" | "folderId" | "status" | "video">>;
export type BookmarkSearchParams = Record<string, string | string[] | undefined>;

export function bookmarkQueryInputFromParams(params: BookmarkSearchParams = {}, pageSize?: number): BookmarkQueryInput {
  return { ...params, query: params.q ?? "", ...(pageSize === undefined ? {} : { pageSize }) };
}

const tokens = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_]+/gu) ?? [];

/** Words match whole tokens; phrases match adjacent tokens in order within one field. */
export function matchesBookmarkText(fields: Array<string | null>, query: string, mode: Exclude<BookmarkTextMode, "substring">) {
  const requested = tokens(query);
  if (!requested.length) return false;
  const documents = fields.map((field) => tokens(field ?? ""));
  if (mode === "word") {
    const words = new Set(documents.flat());
    return requested.every((word) => words.has(word));
  }
  return documents.some((words) => words.some((_, index) => requested.every((word, offset) => words[index + offset] === word)));
}
