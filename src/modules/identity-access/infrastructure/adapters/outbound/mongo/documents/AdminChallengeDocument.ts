/**
 * Mongo document shape for `AdminChallenges` (design super-admin-auth,
 * follows the CHALLENGE-STORE convention — PascalCase, like `MfaChallenges`
 * — not the `AdminOrganization` aggregate's camelCase, design D39). `_id` is
 * the `challengeId` (the store key, separate from the signed `Challenge`
 * secret) — a plain string, never a driver-generated `ObjectId`, so the
 * atomic CAS `consume` can match on `{_id, ConsumedAt: null,
 * ExpiresAt:{$gt:now}}` with no secondary lookup.
 *
 * `ExpiresAtDate` is a BSON `Date` MIRROR of `ExpiresAt` (an `Instant`
 * ISO-8601 string) — TTL only, identical pattern to `MfaChallengeDocument.
 * ExpiresAtDate`. Mongo's TTL monitor acts only on a real BSON `Date` field;
 * a TTL index on the string field would create successfully and silently
 * delete nothing.
 */
export interface AdminChallengeDocument {
  readonly _id: string;
  readonly AdminOrganizationId: string;
  readonly Challenge: string;
  readonly ExpiresAt: string;
  readonly ExpiresAtDate: Date;
  readonly ConsumedAt: string | null;
  readonly CreatedAt: string;
}
