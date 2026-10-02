const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function normalizeBookmarkPagination(page: unknown, pageSize: unknown) {
  return {
    page: positiveInteger(page) ?? 1,
    pageSize: Math.min(MAX_PAGE_SIZE, positiveInteger(pageSize) ?? DEFAULT_PAGE_SIZE),
  };
}

export function effectiveBookmarkPagination(page: unknown, pageSize: unknown, total: number) {
  const normalized = normalizeBookmarkPagination(page, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / normalized.pageSize));
  return { ...normalized, page: Math.min(normalized.page, totalPages), totalPages };
}
