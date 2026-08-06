/**
 * Mongo document shape for `Organizations` (design A2: PascalCase collection
 * and field keys). `_id` is the aggregate's branded `OrganizationId` (a
 * `crypto.randomUUID()` string, proposal Approach) — never a
 * driver-generated `ObjectId`, and the single documented exception to the
 * PascalCase rule (design A1).
 */
export interface OrganizationDocument {
  readonly _id: string;
  readonly Name: string;
  readonly Slug: string;
  readonly Domain: string | null;
  readonly Status: string;
  readonly LogoUrl: string | null;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
  /** Set on transition to `CANCELLED` (design D10); written explicitly, never omitted. */
  readonly DeletedAt: string | null;
}
