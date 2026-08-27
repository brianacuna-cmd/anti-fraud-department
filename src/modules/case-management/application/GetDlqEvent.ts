import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OutboxDlqRepository } from '../../../shared/outbox/OutboxDlqRepository.js';
import type { DeadLetterEvent } from '../../../shared/outbox/DeadLetterEvent.js';
import { createOutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';
import { dlqEventNotFound } from '../domain/errors/CaseManagementError.js';

export interface GetDlqEventInput {
  readonly auth: AuthContext;
  readonly dlqEventId: string;
}

export interface GetDlqEventDeps {
  readonly dlq: OutboxDlqRepository;
}

/**
 * Returns a single DLQ event by id, including the full payload and the stored
 * `reason` field (HTTP mapper exposes this as `error_trace` in PR2). PLATFORM_ADMIN
 * only (D1). Returns `DLQ_EVENT_NOT_FOUND` (404) when no row matches.
 */
export function createGetDlqEventUseCase(deps: GetDlqEventDeps) {
  return async function getDlqEvent(input: GetDlqEventInput): Promise<DeadLetterEvent> {
    requirePlatformAdmin(input.auth);

    const id = createOutboxEventId(input.dlqEventId);
    const event = await deps.dlq.findById(id);
    if (event === null) {
      throw dlqEventNotFound(input.dlqEventId);
    }
    return event;
  };
}

export type GetDlqEventService = ReturnType<typeof createGetDlqEventUseCase>;
