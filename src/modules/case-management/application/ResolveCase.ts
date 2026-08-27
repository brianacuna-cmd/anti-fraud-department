import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import { assertDecided, assertEnforcementResolved } from '../domain/services/WorkflowStepGate.js';
import { closeCase, type CloseCaseDeps, type CloseCaseInput } from './closeCase.js';

export type ResolveCaseInput = CloseCaseInput;
/** Resolve REQUIRES the outbox deps (it always emits CASE_RESOLVED) plus the
 * decision/enforcement repos used by the workflow-step gate below. */
export type ResolveCaseDeps = CloseCaseDeps & {
  readonly outbox: OutboxEventRepository;
  readonly generateOutboxEventId: () => OutboxEventId;
  readonly decisions: AnalystDecisionRepository;
  readonly enforcementActions: EnforcementActionRepository;
};

/**
 * Resolves a case (OPEN|IN_REVIEW -> RESOLVED). SUPERVISOR only.
 * Stops the SLA (clears the case dueDate) and emits a CASE_RESOLVED
 * `outbox_events` row in the same transaction. See `closeCase`.
 *
 * Workflow-step gate (`assertBeforeTransition`): resolving requires at
 * least one analyst decision on file, and — when any decision is
 * `FRAUD_CONFIRMED` — at least one enforcement action requested for the
 * case. `ArchiveCase` does not go through `closeCase` with this hook, so
 * archiving is unaffected.
 */
export function createResolveCaseUseCase(deps: ResolveCaseDeps) {
  return closeCase(deps, {
    closureType: 'RESOLVED',
    auditAction: 'RESOLVE_CASE',
    stopSla: true,
    outboxEventType: 'CASE_RESOLVED',
    assertBeforeTransition: async (existing, tx) => {
      const [decisions, enforcementActions] = await Promise.all([
        deps.decisions.findByCaseId(existing.id, tx),
        deps.enforcementActions.findByCaseId(existing.id, tx),
      ]);
      assertDecided(existing, decisions.length > 0);
      const needsEnforcement = decisions.some((decision) => decision.decision === 'FRAUD_CONFIRMED');
      assertEnforcementResolved(existing, needsEnforcement, enforcementActions.length > 0);
    },
  });
}
