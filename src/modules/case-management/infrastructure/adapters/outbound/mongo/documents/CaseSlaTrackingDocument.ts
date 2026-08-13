/**
 * Mongo document shape for `CaseSlaTracking` (design: "Persistence —
 * collections, documents, mappers"). `_id` is the aggregate's branded
 * `CaseSlaTrackingId` (a native MongoDB `ObjectId`, mirrors `CaseDocument`).
 *
 * `DueDate` is the ISO-8601 `Instant` string (source of truth, per the
 * domain's own `Instant` type). `DueDateAt` is a BSON `Date` MIRROR of the
 * same value, written on every save — same pattern as `Sessions
 * .FamilyExpiresAtDate` (design ADR-6) — needed because Mongo range queries
 * (`findDueForSweep`) and any future TTL/index work require a real BSON
 * `Date`, not a string comparison.
 */

import type { ObjectId } from "mongodb";

export interface CaseSlaTrackingDocument {
  readonly _id: ObjectId;
  readonly CaseId: ObjectId;
  readonly DueDate: string;
  readonly DueDateAt: Date;
  readonly Status: string;
  readonly NotificationSent: boolean;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}
