const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface PaginationParams {
  readonly limit: number;
  readonly cursor?: string;
}

interface RawPaginationQuery {
  readonly limit?: unknown;
  readonly cursor?: unknown;
}

/**
 * Normalizes `?limit=&cursor=` query params (PRD §10 — cursor pagination,
 * never offset). Invalid/missing/oversized `limit` degrades to the default
 * rather than rejecting the request.
 */
export function parsePaginationParams(query: RawPaginationQuery): PaginationParams {
  const limit = resolveLimit(query.limit);
  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
  return cursor === undefined ? { limit } : { limit, cursor };
}

function resolveLimit(rawLimit: unknown): number {
  if (typeof rawLimit !== 'string') {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * Builds `{items, nextCursor}` from a repository fetch of `limit + 1` rows
 * (the caller's convention for detecting "more results exist" without a
 * separate count query). `nextCursor` is the last returned item's cursor id,
 * matching the `{_id: {$gt: cursor}}` ascending-`_id` contract.
 */
export function buildCursorPage<T extends { readonly cursorId: string }>(
  fetched: readonly T[],
  limit: number,
): CursorPage<T> {
  const hasMore = fetched.length > limit;
  const items = hasMore ? fetched.slice(0, limit) : fetched;
  const nextCursor = hasMore ? items[items.length - 1]!.cursorId : null;
  return { items, nextCursor };
}
