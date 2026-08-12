/**
 * Mongo document shape for `Organizations` (design A2: PascalCase collection
 * and field keys). `_id` is the aggregate's branded `OrganizationId` (a
 * `crypto.randomUUID()` string, proposal Approach) — never a
 * driver-generated `ObjectId`, and the single documented exception to the
 * PascalCase rule (design A1).
 */
import type { ObjectId } from "mongodb";

export interface OrganizationDocument {
  readonly _id: ObjectId;
  readonly Name: string;
  readonly Slug: string;
  readonly Domain: string | null;
  readonly Status: string;
  /**
   * Free-form persistence/domain-only settings bag (design D8/A11, schema-v2
   * PR5 — replaces `LogoUrl`). Defaults to `{}`; never exposed over HTTP.
   */
  readonly Configuration: Record<string, unknown>;
  /**
   * Organization's own login credentials (design D36, pulled forward as a
   * Phase 4 judgment call — both `null` until Phase 7 wires the bootstrap
   * flow that actually sets them; `OrganizationActorGateway` never matches a
   * `null` `Email`). Written explicitly, never omitted (design D38's "any
   * unique index over a nullable field must be partial with a `$type`
   * predicate" general rule — see `ensureIndexes.ts`'s `organization_email_unique`).
   */
  readonly Email: string | null;
  readonly PasswordHash: string | null;
  readonly LoginAttempts: number;
  readonly BlockedUntil: string | null;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
  /** Set on transition to `CANCELLED` (design D10); written explicitly, never omitted. */
  readonly DeletedAt: string | null;
}
