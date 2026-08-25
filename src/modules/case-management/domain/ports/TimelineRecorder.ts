import type { CaseTimelineEvent } from '../model/aggregates/CaseTimelineEvent.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the append-only `CaseTimeline` (spec: "CaseTimeline is
 * append-only", design: "TimelineRecorder ... insert-only, AuditRecorder
 * shape"). Deliberately has ONLY `record` — no `update`/`delete`/`replace`
 * method exists on this interface, mirroring `AuditLogRepository`'s
 * append-only shape. Called INSIDE `unitOfWork.withTransaction` alongside
 * the business mutation, same pattern as identity-access's `AuditRecorder`.
 */
export interface TimelineRecorder {
  record(event: CaseTimelineEvent, tx?: Transaction): Promise<void>;
  listByCaseId(caseId: string): Promise<readonly CaseTimelineEvent[]>;
}
