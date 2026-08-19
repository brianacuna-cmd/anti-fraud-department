import { outboxInvariant } from './OutboxError.js';

/** Delivery lifecycle of an `outbox_events` row. */
export type OutboxEventStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

export const OUTBOX_EVENT_STATUSES = ['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'] as const;

const VALID: ReadonlySet<string> = new Set<OutboxEventStatus>(OUTBOX_EVENT_STATUSES);

export function createOutboxEventStatus(value: string): OutboxEventStatus {
  if (!VALID.has(value)) {
    throw outboxInvariant('OutboxEventStatus must be one of PENDING, PROCESSING, PUBLISHED, FAILED', {
      value,
    });
  }
  return value as OutboxEventStatus;
}
