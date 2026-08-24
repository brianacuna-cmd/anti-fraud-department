import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AmlAlert } from '../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertStatus } from '../domain/model/value-objects/AmlAlertStatus.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { AmlExpedienteTimelineRecorder } from '../domain/ports/AmlExpedienteTimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createAmlAlertId } from '../domain/model/value-objects/AmlAlertId.js';
import { amlAlertNotFound, forbiddenCrossTenant, invariantViolation } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/** Compliance verdict on a triaged alert (RF-1). */
export type AmlAlertDictamen = 'CONFIRMED_MATCH' | 'FALSE_POSITIVE';

const DICTAMEN_TO_STATUS: Record<AmlAlertDictamen, AmlAlertStatus> = {
  CONFIRMED_MATCH: 'RESOLVED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
};

export interface ResolveAmlAlertInput {
  readonly auth: AuthContext;
  readonly alertId: string;
  readonly dictamen: AmlAlertDictamen;
  readonly justificacion: string;
}

export interface ResolveAmlAlertDeps {
  readonly amlAlertRepository: AmlAlertRepository;
  readonly timelineRecorder: AmlExpedienteTimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => string;
}

function nextStatusFor(dictamen: AmlAlertDictamen): AmlAlertStatus {
  const next = DICTAMEN_TO_STATUS[dictamen];
  if (next === undefined) {
    throw invariantViolation('dictamen must be one of CONFIRMED_MATCH, FALSE_POSITIVE', { dictamen });
  }
  return next;
}

/**
 * Disposition path: an analyst records a compliance verdict (`dictamen`)
 * with a mandatory `justificacion`. Within ONE `unitOfWork.withTransaction`:
 * transitions the alert (RF-1/RF-4), appends the STATE_CHANGED expediente
 * timeline row (parity with `TransitionAmlAlert`), and writes exactly one
 * audit row (RF-3) — both-or-neither via the shared transaction handle.
 */
export function createResolveAmlAlertUseCase(deps: ResolveAmlAlertDeps) {
  return async function resolveAmlAlert(input: ResolveAmlAlertInput): Promise<AmlAlert> {
    const organizationId = requireTenantContext(input.auth);
    const alertId = createAmlAlertId(input.alertId);
    const justificacion = input.justificacion.trim();
    if (justificacion.length === 0) {
      throw invariantViolation('justificacion must be a non-empty string', { justificacion: input.justificacion });
    }
    const next = nextStatusFor(input.dictamen);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.amlAlertRepository.findById(alertId, tx);
      if (existing === null) {
        throw amlAlertNotFound(alertId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('aml alert does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const previous = existing.estado;
      const transitioned = existing.transitionTo(next, now);
      await deps.amlAlertRepository.save(transitioned, tx);

      await deps.timelineRecorder.record(
        {
          id: deps.generateTimelineEventId(),
          caseId: String(transitioned.id),
          eventType: 'STATE_CHANGED',
          previousValue: previous,
          newValue: transitioned.estado,
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
          detail: { dictamen: input.dictamen, justificacion },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return transitioned;
    });
  };
}
