import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AmlAlert } from '../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { AmlExpedienteTimelineRecorder } from '../domain/ports/AmlExpedienteTimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createAmlAlertId } from '../domain/model/value-objects/AmlAlertId.js';
import { amlAlertNotFound, forbiddenCrossTenant, invalidTransition } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface AmlAlertCaseOpener {
  open(input: {
    readonly auth: AuthContext;
    readonly customerId: string;
    readonly riskScore: number;
    readonly priority: string;
    readonly tags?: readonly string[];
    readonly idempotencyKey?: string;
  }): Promise<{ readonly caseId: string }>;
}

export interface EscalateAmlAlertInput {
  readonly auth: AuthContext;
  readonly alertId: string;
}

export interface EscalateAmlAlertResult {
  readonly alert: AmlAlert;
  readonly caseId: string;
  readonly alreadyEscalated: boolean;
}

export interface EscalateAmlAlertDeps {
  readonly amlAlertRepository: AmlAlertRepository;
  readonly caseOpener: AmlAlertCaseOpener;
  readonly timelineRecorder: AmlExpedienteTimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => string;
}

/**
 * Human confirmation: open a fraud Case and link it. Does not close the AML
 * alert (independent lifecycle). False positives must use TransitionAmlAlert
 * instead — they never touch `cases`. Injected `caseOpener` is wired to
 * CreateCase at the composition root.
 */
export function createEscalateAmlAlertUseCase(deps: EscalateAmlAlertDeps) {
  return async function escalateAmlAlert(input: EscalateAmlAlertInput): Promise<EscalateAmlAlertResult> {
    const organizationId = requireTenantContext(input.auth);
    const alertId = createAmlAlertId(input.alertId);

    const existing = await deps.amlAlertRepository.findById(alertId);
    if (existing === null) {
      throw amlAlertNotFound(alertId);
    }
    if (existing.organizationId !== organizationId) {
      throw forbiddenCrossTenant('aml alert does not belong to the actor organization');
    }
    if (existing.caseId !== null) {
      return { alert: existing, caseId: existing.caseId, alreadyEscalated: true };
    }
    if (existing.estado === 'RESOLVED' || existing.estado === 'FALSE_POSITIVE') {
      throw invalidTransition(existing.estado, 'ESCALATED');
    }

    const opened = await deps.caseOpener.open({
      auth: input.auth,
      customerId: existing.customerId,
      riskScore: existing.confianza,
      priority: existing.severidad,
      tags: ['AML', existing.tipoAlerta],
      idempotencyKey: String(existing.id),
    });

    // Persist the case link FIRST, in its own minimal transaction, so that a
    // failure in the subsequent transition/timeline step cannot lose the
    // caseId. Once linked, any retry short-circuits on `caseId !== null`
    // (above) and returns `alreadyEscalated` instead of opening a SECOND case.
    //
    // Duplicate-Case window CLOSED: `caseOpener.open()` forwards the alert id
    // as CreateCase's `idempotencyKey`, so even if THIS save (or anything
    // after `caseOpener.open()`) fails and a retry re-opens a case, the
    // idempotent short-circuit in `CreateCase` returns the SAME case instead
    // of creating a second one.
    const linkedNow = deps.clock.now();
    const linked = await deps.unitOfWork.withTransaction(async (tx) => {
      const withCase = existing.linkCase(opened.caseId, linkedNow);
      await deps.amlAlertRepository.save(withCase, tx);
      return withCase;
    });

    // The alert is now durably linked. Advance OPEN -> INVESTIGATING and append
    // the timeline row in a second transaction; if this fails, the caseId is
    // already safe, so a retry returns `alreadyEscalated` (no duplicate case).
    if (existing.estado !== 'OPEN') {
      return { alert: linked, caseId: opened.caseId, alreadyEscalated: false };
    }
    const investigating = await deps.unitOfWork.withTransaction(async (tx) => {
      const advanced = linked.transitionTo('INVESTIGATING', linkedNow);
      await deps.amlAlertRepository.save(advanced, tx);
      await deps.timelineRecorder.record(
        {
          id: deps.generateTimelineEventId(),
          caseId: String(advanced.id),
          eventType: 'STATE_CHANGED',
          previousValue: 'OPEN',
          newValue: advanced.estado,
          createdBy: input.auth.userId,
          createdAt: linkedNow,
        },
        tx,
      );
      return advanced;
    });
    return { alert: investigating, caseId: opened.caseId, alreadyEscalated: false };
  };
}
