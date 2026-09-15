import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import {
  assertEnforcementResolved,
  resolveClosureVerdict,
  type LatestDecision,
} from '../domain/services/WorkflowStepGate.js';
import type { AnalystDecision } from '../domain/model/aggregates/AnalystDecision.js';
import { closeCase, type CloseCaseDeps } from './closeCase.js';
/** Resolve REQUIRES the outbox deps (it always emits CASE_RESOLVED) plus the
 * decision/enforcement repos used by the workflow-step gate below. */
export type ResolveCaseDeps = CloseCaseDeps & {
  readonly outbox: OutboxEventRepository;
  readonly generateOutboxEventId: () => OutboxEventId;
  readonly decisions: AnalystDecisionRepository;
  readonly enforcementActions: EnforcementActionRepository;
};

/**
 * Resolves a case (IN_REVIEW|PENDING_DOCUMENTATION -> RESOLVED). SUPERVISOR only.
 * Stops the SLA (clears the case dueDate) and emits a CASE_RESOLVED
 * `outbox_events` row in the same transaction. See `closeCase`.
 *
 * The verdict is not typed again here: outcome and reason default to the
 * latest analyst decision (`resolveClosureVerdict`). An explicit outcome must
 * agree with that decision; only the procedural ones (DUPLICATE,
 * DOCUMENTATION_NOT_PROVIDED) close a case without a decision. When any
 * decision is `FRAUD_CONFIRMED`, an enforcement action must be on file.
 */
export function createResolveCaseUseCase(deps: ResolveCaseDeps) {
  return closeCase(deps, {
    closureType: 'RESOLVED',
    auditAction: 'RESOLVE_CASE',
    stopSla: true,
    outboxEventType: 'CASE_RESOLVED',
    prepareClosure: async (existing, tx, input) => {
      const [decisions, enforcementActions] = await Promise.all([
        deps.decisions.findByCaseId(existing.id, tx),
        deps.enforcementActions.findByCaseId(existing.id, tx),
      ]);
      const verdict = resolveClosureVerdict(existing, input, latestDecision(decisions));
      const needsEnforcement = decisions.some((decision) => decision.decision === 'FRAUD_CONFIRMED');
      assertEnforcementResolved(existing, needsEnforcement, enforcementActions.length > 0);
      return verdict;
    },
  });
}

/** The most recent verdict supersedes earlier ones. */
function latestDecision(decisions: readonly AnalystDecision[]): LatestDecision | null {
  let latest: AnalystDecision | null = null;
  for (const decision of decisions) {
    if (latest === null || decision.createdAt > latest.createdAt) {
      latest = decision;
    }
  }
  return latest === null ? null : { decision: latest.decision, comment: latest.comment };
}
