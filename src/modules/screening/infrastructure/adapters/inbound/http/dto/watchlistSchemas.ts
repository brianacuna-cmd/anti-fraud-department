import { z } from 'zod';

const watchlistTypeEnum = z.enum(['BLACKLIST', 'WHITELIST']);
const watchlistStatusEnum = z.enum(['ACTIVE', 'INACTIVE']);

/** Coerces Express query `string | string[]` into a string array. */
function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** POST /watchlists request body. */
export const createWatchlistSchema = z.object({
  name: z.string().trim().min(1),
  source: z.string().trim().min(1),
  type: watchlistTypeEnum,
  description: z.string().nullable().optional(),
});

/**
 * GET /watchlists query. `organization_id` comes from the tenant auth context,
 * never from the query string.
 */
export const listWatchlistsQuerySchema = z.object({
  type: z.preprocess(asStringArray, z.array(watchlistTypeEnum).optional()),
  status: z.preprocess(asStringArray, z.array(watchlistStatusEnum).optional()),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * PATCH /watchlists/:id request body (all fields optional).
 * `status` is not patchable: deactivation is DELETE so the entry cascade
 * and `deleted_at` stay on one path (RF-5).
 */
export const updateWatchlistSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    source: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

export type CreateWatchlistBody = z.infer<typeof createWatchlistSchema>;
export type ListWatchlistsQuery = z.infer<typeof listWatchlistsQuerySchema>;
export type UpdateWatchlistBody = z.infer<typeof updateWatchlistSchema>;
