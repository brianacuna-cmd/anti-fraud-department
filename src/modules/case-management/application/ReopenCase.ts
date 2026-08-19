import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { OutboxRepository } from '../domain/ports/OutboxRepository.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { InitializeCaseSlaService } from './InitializeCaseSla.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { OutboxEvent } from '../domain/model/aggregates/OutboxEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createCaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';

export interface ReopenCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  /** Destino de la reapertura. Por defecto IN_REVIEW, que es lo que pide CASE-009. */
  readonly nextStatus?: string;
  readonly reason?: string;
}

export interface ReopenCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
  readonly initializeCaseSla: InitializeCaseSlaService;
  readonly outbox: OutboxRepository;
}

/**
 * CASE-009 — desarchiva un expediente RESOLVED o ARCHIVED y lo devuelve a
 * IN_REVIEW reiniciando el seguimiento de SLA.
 *
 * Existe como caso de uso propio y no como una llamada mas a
 * `TransitionCaseStatus` por dos motivos que no son de estilo:
 *
 * 1. `Case.reopen` comprueba el estado de PARTIDA, algo que la tabla de
 *    transiciones por si sola no puede expresar: la arista OPEN -> IN_REVIEW
 *    es un avance perfectamente valido, asi que sin esa comprobacion un
 *    "reabrir" sobre un caso ya abierto se aceptaria en silencio.
 * 2. Reabrir reinicia el reloj. Sin el reinicio el expediente arrastraria el
 *    `dueDate` del ciclo anterior —vencido, casi siempre— y naceria
 *    incumpliendo su propio SLA en el mismo instante de reabrirse.
 */
export function createReopenCaseUseCase(deps: ReopenCaseDeps) {
  return async function reopenCase(input: ReopenCaseInput): Promise<Case> {
    const caseId = createCaseId(input.caseId);
    const nextStatus = createCaseStatus(input.nextStatus ?? 'IN_REVIEW');
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase = await deps.cases.findById(caseId, tx);
      if (!kase) {
        throw caseNotFound(input.caseId);
      }
      if (
        input.auth.actorType !== 'PLATFORM_ADMIN' &&
        input.auth.organizationId &&
        kase.organizationId !== input.auth.organizationId
      ) {
        throw forbiddenCrossTenant();
      }

      const organizationId = input.auth.organizationId ?? kase.organizationId;
      const actorId = input.auth.userId ?? input.auth.organizationId ?? 'PLATFORM_ADMIN';

      const previousStatus = kase.status;

      // Lanza si el caso no estaba cerrado. Se comprueba antes de tocar el SLA
      // para no dejar un reloj reiniciado sobre un caso que no llego a reabrirse.
      let updated = kase.reopen(nextStatus, now);

      const dueDate = await deps.initializeCaseSla({
        organizationId,
        caseId: updated.id,
        priority: updated.priority,
        now,
        tx,
      });
      updated = updated.withDueDate(dueDate, now);

      await deps.cases.save(updated, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: updated.id,
          eventType: 'CASE_REOPENED',
          previousValue: previousStatus,
          newValue: updated.status,
          createdBy: actorId,
          createdAt: now,
        }),
        tx,
      );

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: updated.id,
          eventType: 'SLA_RESET',
          previousValue: kase.dueDate,
          newValue: dueDate,
          createdBy: actorId,
          createdAt: now,
        }),
        tx,
      );

      await deps.outbox.record(
        OutboxEvent.create({
          id: deps.generateTimelineEventId(),
          aggregateType: 'case',
          aggregateId: updated.id,
          eventType: 'case.reopened',
          payload: {
            caseId: updated.id,
            organizationId,
            previousStatus,
            nextStatus: updated.status,
            dueDate,
            reason: input.reason ?? null,
          },
          now,
        }),
        tx,
      );

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId,
          action: 'REOPEN_CASE',
          resource: 'case',
          resourceId: updated.id,
          detail: {
            previousStatus,
            nextStatus: updated.status,
            previousDueDate: kase.dueDate,
            dueDate,
            reason: input.reason ?? null,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
