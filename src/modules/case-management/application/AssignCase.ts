import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createAssignedTo, type AssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { Notifier } from '../domain/ports/Notifier.js';
import { assigneeNotFound, caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';

export interface AssignCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly assignedTo: { readonly type: string; readonly id: string } | null;
}

export interface AssignCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
  readonly assigneeDirectory: AssigneeDirectory;
  /** Opcional: sin el, la reasignacion funciona pero no avisa (CASE-006). */
  readonly notifier?: Notifier;
}

export function createAssignCaseUseCase(deps: AssignCaseDeps) {
  return async function assignCase(input: AssignCaseInput): Promise<Case> {
    const caseId = createCaseId(input.caseId);
    const now = deps.clock.now();

    let assignedToVO: AssignedTo | null = null;
    if (input.assignedTo?.id && input.assignedTo?.type) {
      assignedToVO = createAssignedTo(input.assignedTo.type, input.assignedTo.id);
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase = await deps.cases.findById(caseId, tx);
      if (!kase) {
        throw caseNotFound(input.caseId);
      }
      if (input.auth.actorType !== 'PLATFORM_ADMIN' && input.auth.organizationId && kase.organizationId !== input.auth.organizationId) {
        throw forbiddenCrossTenant();
      }

      const organizationId = input.auth.organizationId ?? kase.organizationId;
      const actorId = input.auth.userId ?? input.auth.organizationId ?? 'PLATFORM_ADMIN';

      // El destinatario tiene que existir. Sin esta comprobación se aceptaba
      // cualquier id — un usuario borrado, uno de otra organización o un
      // simple error de tecleo — y el caso quedaba con un dueño que no está.
      if (assignedToVO) {
        const exists =
          assignedToVO.type === 'USER'
            ? await deps.assigneeDirectory.userExists(organizationId, assignedToVO.id)
            : await deps.assigneeDirectory.roleExists(assignedToVO.id);

        if (!exists) {
          throw assigneeNotFound(assignedToVO.type, assignedToVO.id);
        }
      }

      const previousAssigned = kase.assignedTo
        ? `${kase.assignedTo.type}:${kase.assignedTo.id}`
        : null;
      const nextAssigned = assignedToVO
        ? `${assignedToVO.type}:${assignedToVO.id}`
        : null;

      const updatedCase = kase.reassign(assignedToVO, now);
      await deps.cases.save(updatedCase, tx);

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: updatedCase.id,
        eventType: 'ASSIGNED',
        previousValue: previousAssigned,
        newValue: nextAssigned,
        createdBy: actorId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId,
          action: 'REASSIGN_CASE',
          resource: 'case',
          resourceId: updatedCase.id,
          detail: { previousAssigned, nextAssigned },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      // CASE-006: se avisa al NUEVO responsable, y solo si es una persona.
      // Un rol no tiene bandeja: notificar a "ANALYST" no llegaria a nadie en
      // concreto, y liberar el caso a la bandeja general tampoco tiene
      // destinatario. Tampoco se avisa a quien se asigna a si mismo: acaba de
      // hacerlo, ya lo sabe.
      if (
        deps.notifier &&
        assignedToVO?.type === 'USER' &&
        assignedToVO.id !== input.auth.userId
      ) {
        await deps.notifier.notify(
          {
            organizationId,
            recipientUserId: assignedToVO.id,
            alertType: 'CASO_ASIGNADO',
            title: 'Se te ha asignado un expediente',
            body: `El caso ${updatedCase.id} (riesgo ${updatedCase.riskScore}, prioridad ${updatedCase.priority}) esta ahora a tu nombre.`,
            resourceType: 'case',
            resourceId: updatedCase.id,
          },
          tx,
        );
      }

      return updatedCase;
    });
  };
}
