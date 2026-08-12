/**
 * Mongo document shape for `CaseSlaTracking` (design: "Persistence —
 * collections, documents, mappers"). `_id` is the aggregate's branded
 * `CaseSlaTrackingId` (a `crypto.randomUUID()` string) — never a
 * driver-generated `ObjectId` (mirrors `CaseDocument`'s ADR-0 override).
 *
 * `DueDate` is the ISO-8601 `Instant` string (source of truth, per the
 * domain's own `Instant` type). `DueDateAt` is a BSON `Date` MIRROR of the
 * same value, written on every save — same pattern as `Sessions
 * .FamilyExpiresAtDate` (design ADR-6) — needed because Mongo range queries
 * (`findDueForSweep`) and any future TTL/index work require a real BSON
 * `Date`, not a string comparison.
 */
export interface CaseSlaTrackingDocument {
  readonly _id: string;
  readonly CaseId: string;
  readonly DueDate: string;
  readonly DueDateAt: Date;
  readonly Status: string;
  readonly NotificationSent: boolean;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}
