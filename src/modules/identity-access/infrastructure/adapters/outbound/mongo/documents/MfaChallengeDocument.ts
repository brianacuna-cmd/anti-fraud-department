/**
 * Mongo document shape for `MfaChallenges` (design D1, two-step-login, A2:
 * PascalCase keys). `_id` is the token's `jti` — a plain string, never a
 * driver-generated `ObjectId` (design A1/D37 convention, mirrored from
 * `Sessions`) — so the atomic CAS `consume` can match on `{_id, ConsumedAt:
 * null, ExpiresAt:{$gt:now}}` with no secondary lookup.
 *
 * `ExpiresAtDate` is a BSON `Date` MIRROR of `ExpiresAt` (an `Instant`
 * ISO-8601 string) — TTL only (identical pattern to `Sessions.
 * FamilyExpiresAtDate`, design D15). Mongo's TTL monitor acts only on a real
 * BSON `Date` field; a TTL index on the string field would create
 * successfully and silently delete nothing.
 */
export interface MfaChallengeDocument {
  readonly _id: string;
  readonly UserId: string;
  readonly OrganizationId: string | null;
  readonly ActorType: string;
  readonly TokenType: string;
  readonly ExpiresAt: string;
  readonly ExpiresAtDate: Date;
  readonly ConsumedAt: string | null;
  readonly CreatedAt: string;
}
