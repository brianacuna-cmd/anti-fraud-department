/**
 * Mongo document shape for `organizations` (MODELO_DATOS_MONGO.md §3).
 * `_id` is the aggregate's branded `OrganizationId` (a `crypto.randomUUID()`
 * string, proposal Approach) — never a driver-generated `ObjectId`.
 */
export interface OrganizationDocument {
  readonly _id: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string | null;
  readonly status: string;
  readonly logoUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set on transition to `CANCELLED` (design D10); written explicitly, never omitted. */
  readonly deletedAt: string | null;
}
