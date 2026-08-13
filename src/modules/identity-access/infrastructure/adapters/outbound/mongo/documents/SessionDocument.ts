/**
 * Mongo document shape for `Sessions` (design D14, A2: PascalCase keys).
 * `_id` is the aggregate's branded `SessionId` (a native MongoDB `ObjectId`).
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
import type { ObjectId } from "mongodb";

export interface SessionDocument {
  readonly _id: ObjectId;
  readonly UserId: ObjectId | null;
  readonly OrganizationId: ObjectId| null;
  readonly ActorType: string;
  readonly TokenHash: string;
  readonly RefreshTokenHash: string | null;
  readonly ExpiresAt: string;
  readonly RefreshExpiresAt: string | null;
  readonly FamilyId: ObjectId;
  readonly FamilyExpiresAt: string;
  readonly FamilyExpiresAtDate: Date;
  readonly RotatedAt: string | null;
  readonly RotatedFromSessionId: ObjectId | null;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
  /** The single revocation signal (design D14). */
  readonly DeletedAt: string | null;
}
