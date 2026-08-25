import type { CaseTimelineEvent } from '../model/aggregates/CaseTimelineEvent.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Read side of the append-only `CaseTimeline` (the case file needs a
 * queryable log). Kept SEPARATE from `TimelineRecorder` so the write port
 * stays insert-only: the recorder never gains a read method. Returns events
 * for one case, oldest first.
 */
export interface TimelineReader {
  listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseTimelineEvent[]>;
}
