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

/**
 * Encodes a composite (exhausted_at epoch-ms, _id hex) pair into an opaque
 * base64 cursor string for DESC keyset pagination (D3). The encoded form is
 * `base64("<epochMs>:<idHex>")`. Callers pass the epoch-ms from
 * `toDate(event.exhaustedAt).getTime()` and the raw ObjectId hex string.
 */
export function encodeDescCursor(exhaustedAtMs: number, id: string): string {
  return Buffer.from(`${exhaustedAtMs}:${id}`).toString('base64');
}

/**
 * Decodes a cursor produced by `encodeDescCursor`. Returns `null` for any
 * input that is not a valid round-trip (malformed base64, missing separator,
 * non-positive timestamp, empty id). Callers MUST treat `null` as an
 * `INVARIANT_VIOLATION` (400) — never reset silently to page 1.
 */
export function decodeDescCursor(cursor: string): { exhaustedAtMs: number; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const colon = decoded.lastIndexOf(':');
    if (colon === -1) return null;
    const ms = Number(decoded.slice(0, colon));
    const id = decoded.slice(colon + 1);
    if (!Number.isFinite(ms) || ms <= 0 || id.length === 0) return null;
    return { exhaustedAtMs: ms, id };
  } catch {
    return null;
  }
}

/**
 * Builds `{items, nextCursor}` from a repository fetch of `limit + 1` rows
 * for DESC keyset pagination. `cursorOf` maps each item to its opaque cursor
 * value (typically `encodeDescCursor(exhaustedAtMs, id)` — provided by the
 * caller to keep this helper free of domain types).
 */
export function buildDescCursorPage<T>(
  fetched: readonly T[],
  limit: number,
  cursorOf: (item: T) => string,
): CursorPage<T> {
  const hasMore = fetched.length > limit;
  const items = hasMore ? fetched.slice(0, limit) : fetched;
  const nextCursor = hasMore ? cursorOf(items[items.length - 1]!) : null;
  return { items, nextCursor };
}
