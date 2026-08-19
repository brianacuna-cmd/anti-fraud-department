import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { InitializeCaseSlaService } from './InitializeCaseSla.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';

export interface ReclassifyCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly priority?: string;
  readonly tags?: readonly string[];
}

export interface ReclassifyCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
  readonly initializeCaseSla: InitializeCaseSlaService;
}

/**
 * CASE-007 — actualiza etiquetas y severidad del caso.
 *
 * Cambiar la prioridad recalcula la fecha limite, porque la ventana de SLA se
 * deriva de ella: subir un caso a CRITICAL sin acortar su plazo dejaria la
 * severidad como una etiqueta decorativa. El recalculo solo ocurre cuando la
 * prioridad se mueve de verdad — reiniciar el reloj en cada reetiquetado
 * regalaria plazo a quien tocase las etiquetas repetidamente.
 *
 * Emite un asiento de timeline por dimension modificada, no uno combinado:
 * quien audita el expediente suele buscar "cuando se escalo", y una entrada
 * mixta obliga a leer el detalle para saber si la severidad llego a cambiar.
 */
export function createReclassifyCaseUseCase(deps: ReclassifyCaseDeps) {
  return async function reclassifyCase(input: ReclassifyCaseInput): Promise<Case> {
    const caseId = createCaseId(input.caseId);
    const now = deps.clock.now();

    // Se valida antes de abrir la transaccion: una prioridad invalida es un
    // error del llamante, no un motivo para arrancar una escritura.
    const nextPriority = input.priority === undefined ? undefined : createCasePriority(input.priority);

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

      const previousPriority = kase.priority;
      const previousTags = [...kase.tags];

      let updated = kase.reclassify({ priority: nextPriority, tags: input.tags, now });

      const priorityChanged = updated.priority !== previousPriority;
      const tagsChanged = previousTags.join(' ') !== updated.tags.join(' ');

      // Nada cambio: se devuelve el caso sin escribir. Guardar de todos modos
      // llenaria la linea de tiempo de asientos vacios cada vez que la interfaz
      // reenvia el formulario sin tocar nada.
      if (!priorityChanged && !tagsChanged) {
        return kase;
      }

      if (priorityChanged) {
        const dueDate = await deps.initializeCaseSla({
          organizationId,
          caseId: updated.id,
          priority: updated.priority,
          now,
          tx,
        });
        updated = updated.withDueDate(dueDate, now);
      }

      await deps.cases.save(updated, tx);

      if (priorityChanged) {
        await deps.timelineRecorder.record(
          CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: updated.id,
            eventType: 'PRIORITY_CHANGED',
            previousValue: previousPriority,
            newValue: updated.priority,
            createdBy: actorId,
            createdAt: now,
          }),
          tx,
        );
      }

      if (tagsChanged) {
        await deps.timelineRecorder.record(
          CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: updated.id,
            eventType: 'TAGS_CHANGED',
            previousValue: previousTags.join(', ') || null,
            newValue: updated.tags.join(', ') || null,
            createdBy: actorId,
            createdAt: now,
          }),
          tx,
        );
      }

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId,
          action: 'RECLASSIFY_CASE',
          resource: 'case',
          resourceId: updated.id,
          detail: {
            previousPriority,
            nextPriority: updated.priority,
            previousTags,
            nextTags: [...updated.tags],
            dueDateRecalculated: priorityChanged,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
