import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Append-only timeline row for an AML expediente. `caseId` is the
 * `AmlAlertId` (the expediente lives in `aml_alerts`, not `cases`) so the
 * row can be written without coupling screening to case-management.
 */
export type AmlExpedienteTimelineEventType = 'CASE_CREATED' | 'STATE_CHANGED';

export interface AmlExpedienteTimelineEvent {
  readonly id: string;
  readonly caseId: string;
  readonly eventType: AmlExpedienteTimelineEventType;
  readonly previousValue: string | null;
  readonly newValue: string;
  readonly createdBy: string | null;
  readonly createdAt: Instant;
}

export interface AmlExpedienteTimelineRecorder {
  record(event: AmlExpedienteTimelineEvent, tx?: Transaction): Promise<void>;
  listByAlertId(alertId: string, tx?: Transaction): Promise<AmlExpedienteTimelineEvent[]>;
}
