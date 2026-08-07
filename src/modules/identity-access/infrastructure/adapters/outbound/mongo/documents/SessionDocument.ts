/**
 * Mongo document shape for `Sessions` (design D14, A2: PascalCase keys).
 * `_id` is the aggregate's branded `SessionId` (a `crypto.randomUUID()`
 * string, design D37) — never a driver-generated `ObjectId`.
 *
 * `RefreshTokenHash`/`RefreshExpiresAt` are explicitly nullable and WRITTEN
 * explicitly by the mapper, never omitted (design D38) — this repo's
 * mapper convention always writes an explicit `null`, which is exactly what
 * the `Sessions.RefreshTokenHash` partial unique index's
 * `{$exists:true,$type:'string'}` predicate is built to exclude.
 *
 * `FamilyExpiresAtDate` is a BSON `Date` MIRROR of `FamilyExpiresAt` (an
 * `Instant` ISO-8601 string) — TTL only (design D15). Mongo's TTL monitor
 * acts only on a real BSON `Date` field; a TTL index on the string field
 * would create successfully and silently delete nothing.
 */
export interface SessionDocument {
  readonly _id: string;
  readonly UserId: string | null;
  readonly OrganizationId: string | null;
  readonly ActorType: string;
  readonly TokenHash: string;
  readonly RefreshTokenHash: string | null;
  readonly ExpiresAt: string;
  readonly RefreshExpiresAt: string | null;
  readonly FamilyId: string;
  readonly FamilyExpiresAt: string;
  readonly FamilyExpiresAtDate: Date;
  readonly RotatedAt: string | null;
  readonly RotatedFromSessionId: string | null;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
  /** The single revocation signal (design D14). */
  readonly DeletedAt: string | null;
}
