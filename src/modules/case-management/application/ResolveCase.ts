import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import {
  assertDecided,
  assertEnforcementResolved,
  assertOutcomeMatchesDecision,
} from '../domain/services/WorkflowStepGate.js';
import type { AnalystDecision } from '../domain/model/aggregates/AnalystDecision.js';
import type { AnalystDecisionType } from '../domain/model/value-objects/AnalystDecisionType.js';
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
 * Requires a typed `outcome`, which must agree with the latest decision
 * (`assertOutcomeMatchesDecision`).
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
    requireOutcome: true,
    outboxEventType: 'CASE_RESOLVED',
    assertBeforeTransition: async (existing, tx, input) => {
      const [decisions, enforcementActions] = await Promise.all([
        deps.decisions.findByCaseId(existing.id, tx),
        deps.enforcementActions.findByCaseId(existing.id, tx),
      ]);
      assertDecided(existing, decisions.length > 0);
      const needsEnforcement = decisions.some((decision) => decision.decision === 'FRAUD_CONFIRMED');
      assertEnforcementResolved(existing, needsEnforcement, enforcementActions.length > 0);
      if (input.outcome !== undefined) {
        assertOutcomeMatchesDecision(existing, input.outcome, latestDecisionType(decisions));
      }
    },
  });
}

/** The most recent verdict supersedes earlier ones. */
function latestDecisionType(decisions: readonly AnalystDecision[]): AnalystDecisionType | null {
  let latest: AnalystDecision | null = null;
  for (const decision of decisions) {
    if (latest === null || decision.createdAt > latest.createdAt) {
      latest = decision;
    }
  }
  return latest?.decision ?? null;
}
