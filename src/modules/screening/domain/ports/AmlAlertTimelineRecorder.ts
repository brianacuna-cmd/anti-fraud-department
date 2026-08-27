import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Append-only timeline row for an AML alert. `caseId` is the
 * `AmlAlertId` (the alert lives in `aml_alerts`, not `cases`) so the
 * row can be written without coupling screening to case-management.
 */
export type AmlAlertTimelineEventType = 'CASE_CREATED' | 'STATE_CHANGED';

export interface AmlAlertTimelineEvent {
  readonly id: string;
  readonly caseId: string;
  readonly eventType: AmlAlertTimelineEventType;
  readonly previousValue: string | null;
  readonly newValue: string;
  readonly createdBy: string | null;
  readonly createdAt: Instant;
}

export interface AmlAlertTimelineRecorder {
  record(event: AmlAlertTimelineEvent, tx?: Transaction): Promise<void>;
  listByAlertId(alertId: string, tx?: Transaction): Promise<AmlAlertTimelineEvent[]>;
}
