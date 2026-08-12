/**
 * Mongo document shape for `CaseTimeline` (design: "Persistence — collections,
 * documents, mappers"). `_id` is the aggregate's branded `TimelineEventId` (a
 * native MongoDB `ObjectId`, mirrors `AuditLogDocument`). Append-only — no
 * `UpdatedAt`/`DeletedAt` fields exist by design, same as `AuditLogDocument`.
 */

import type { ObjectId } from "mongodb";

export interface CaseTimelineDocument {
  readonly _id: ObjectId;
  readonly CaseId: ObjectId;
  readonly EventType: string;
  readonly PreviousValue: string | null;
  readonly NewValue: string | null;
  readonly CreatedBy: string | null;
  readonly CreatedAt: string;
}
