/**
 * Mongo document shape for `CaseTimeline` (design: "Persistence — collections,
 * documents, mappers"). `_id` is the aggregate's branded `TimelineEventId` (a
 * `crypto.randomUUID()` string) — never a driver-generated `ObjectId`
 * (mirrors `AuditLogDocument`'s ADR-0 override). Append-only — no
 * `UpdatedAt`/`DeletedAt` fields exist by design, same as `AuditLogDocument`.
 */
export interface CaseTimelineDocument {
  readonly _id: string;
  readonly CaseId: string;
  readonly EventType: string;
  readonly PreviousValue: string | null;
  readonly NewValue: string | null;
  readonly CreatedBy: string | null;
  readonly CreatedAt: string;
}
