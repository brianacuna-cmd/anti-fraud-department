import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AmlAlert } from '../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertStatus } from '../domain/model/value-objects/AmlAlertStatus.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { AmlExpedienteTimelineRecorder } from '../domain/ports/AmlExpedienteTimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createAmlAlertId } from '../domain/model/value-objects/AmlAlertId.js';
import { amlAlertNotFound, forbiddenCrossTenant } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface TransitionAmlAlertInput {
  readonly auth: AuthContext;
  readonly alertId: string;
  readonly next: AmlAlertStatus;
}

export interface TransitionAmlAlertDeps {
  readonly amlAlertRepository: AmlAlertRepository;
  readonly timelineRecorder: AmlExpedienteTimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => string;
}

/**
 * Forward-path AML triage: OPEN → INVESTIGATING → RESOLVED|FALSE_POSITIVE.
 * Same transaction: persist the new estado + STATE_CHANGED timeline row
 * keyed by the alert id (compliance inbox, not a fraud Case).
 */
export function createTransitionAmlAlertUseCase(deps: TransitionAmlAlertDeps) {
  return async function transitionAmlAlert(input: TransitionAmlAlertInput): Promise<AmlAlert> {
    const organizationId = requireTenantContext(input.auth);
    const alertId = createAmlAlertId(input.alertId);

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
      const transitioned = existing.transitionTo(input.next, now);
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

      return transitioned;
    });
  };
}
