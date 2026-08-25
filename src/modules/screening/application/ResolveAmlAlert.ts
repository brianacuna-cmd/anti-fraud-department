import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AmlAlert } from '../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertStatus } from '../domain/model/value-objects/AmlAlertStatus.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { AmlAlertTimelineRecorder } from '../domain/ports/AmlAlertTimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createAmlAlertId } from '../domain/model/value-objects/AmlAlertId.js';
import { amlAlertNotFound, forbiddenCrossTenant, invariantViolation } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/** Compliance verdict on a triaged alert (RF-1). */
export type AmlAlertVerdict = 'CONFIRMED_MATCH' | 'FALSE_POSITIVE';

const VERDICT_TO_STATUS: Record<AmlAlertVerdict, AmlAlertStatus> = {
  CONFIRMED_MATCH: 'RESOLVED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
};

export interface ResolveAmlAlertInput {
  readonly auth: AuthContext;
  readonly alertId: string;
  readonly verdict: AmlAlertVerdict;
  readonly justification: string;
}

export interface ResolveAmlAlertDeps {
  readonly amlAlertRepository: AmlAlertRepository;
  readonly timelineRecorder: AmlAlertTimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => string;
}

function nextStatusFor(verdict: AmlAlertVerdict): AmlAlertStatus {
  const next = VERDICT_TO_STATUS[verdict];
  if (next === undefined) {
    throw invariantViolation('verdict must be one of CONFIRMED_MATCH, FALSE_POSITIVE', { verdict });
  }
  return next;
}

/**
 * Disposition path: an analyst records a compliance verdict
 * with a mandatory justification. Within ONE `unitOfWork.withTransaction`:
 * transitions the alert (RF-1/RF-4), appends the STATE_CHANGED timeline
 * timeline row (parity with `TransitionAmlAlert`), and writes exactly one
 * audit row (RF-3) — both-or-neither via the shared transaction handle.
 */
export function createResolveAmlAlertUseCase(deps: ResolveAmlAlertDeps) {
  return async function resolveAmlAlert(input: ResolveAmlAlertInput): Promise<AmlAlert> {
    const organizationId = requireTenantContext(input.auth);
    const alertId = createAmlAlertId(input.alertId);
    const justification = input.justification.trim();
    if (justification.length === 0) {
      throw invariantViolation('justification must be a non-empty string', { justification: input.justification });
    }
    const next = nextStatusFor(input.verdict);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.amlAlertRepository.findById(alertId, tx);
      if (existing === null) {
        throw amlAlertNotFound(alertId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('aml alert does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const previous = existing.status;
      const transitioned = existing.transitionTo(next, now);
      await deps.amlAlertRepository.save(transitioned, tx);

      await deps.timelineRecorder.record(
        {
          id: deps.generateTimelineEventId(),
          caseId: String(transitioned.id),
          eventType: 'STATE_CHANGED',
          previousValue: previous,
          newValue: transitioned.status,
          createdBy: input.auth.userId,
          createdAt: now,
        },
        tx,
      );

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'RESOLVE_AML_ALERT',
          resource: 'aml_alert',
          resourceId: String(alertId),
          detail: { verdict: input.verdict, justification },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return transitioned;
    });
  };
}
