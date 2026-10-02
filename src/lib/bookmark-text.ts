import type { Prisma } from "@prisma/client";

export type TextMatch = "substring" | "phrase" | "word";

const FIELDS = ["text", "summary", "category", "authorUsername", "authorName", "tags"] as const;

export function normalizeTextMatch(value: unknown): TextMatch {
  return value === "phrase" || value === "word" ? value : "substring";
}

/** Substring mode is case-insensitive containment, so "nomic" matches "economic". */
export function textMatches(haystack: string, query: string, mode: TextMatch) {
  const needle = query.trim();
  if (!needle) return false;
  if (mode === "substring") return haystack.toLowerCase().includes(needle.toLowerCase());
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu").test(haystack);
}

export function textMatchClause(query: string, mode: TextMatch): Prisma.BookmarkWhereInput {
  if (mode === "substring") {
    return { OR: FIELDS.map((field) => ({ [field]: { contains: query } })) };
  }
  const token = query.trim();
  const edges = [" ", ".", ",", "!", "?", ":", ";", "\n", "\t", "(", ")", "\"", "'"];
  return {
    OR: FIELDS.flatMap((field) => [
      { [field]: { equals: token } },
      { [field]: { startsWith: `${token} ` } },
      { [field]: { endsWith: ` ${token}` } },
      { [field]: { contains: ` ${token} ` } },
      ...edges.flatMap((edge) => [
        { [field]: { contains: ` ${token}${edge}` } },
        { [field]: { contains: `${edge}${token} ` } },
        { [field]: { startsWith: `${token}${edge}` } },
        { [field]: { endsWith: `${edge}${token}` } },
      ]),
    ]),
  };
}

export const SUBSTRING_MATCH_HELP =
  "Substring search can match inside a longer word. For example, nomic matches economic. Choose Whole word or Exact phrase when the boundary matters.";
