import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import { closeCase, type CloseCaseDeps, type CloseCaseInput } from './closeCase.js';

export type ResolveCaseInput = CloseCaseInput;
/** Resolve REQUIRES the outbox deps (it always emits CASE_RESOLVED). */
export type ResolveCaseDeps = CloseCaseDeps & {
  readonly outbox: OutboxEventRepository;
  readonly generateOutboxEventId: () => OutboxEventId;
};

/**
 * Resolves a case (OPEN|IN_REVIEW -> RESOLVED). SUPERVISOR only.
 * Stops the SLA (clears the case dueDate) and emits a CASE_RESOLVED
 * `outbox_events` row in the same transaction. See `closeCase`.
 */
export function createResolveCaseUseCase(deps: ResolveCaseDeps) {
  return closeCase(deps, {
    closureType: 'RESOLVED',
    auditAction: 'RESOLVE_CASE',
    stopSla: true,
    outboxEventType: 'CASE_RESOLVED',
  });
}
