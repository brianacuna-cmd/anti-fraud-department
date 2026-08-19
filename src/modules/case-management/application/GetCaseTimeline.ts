import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { AssigneeDirectory, ActorKind } from '../domain/ports/AssigneeDirectory.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCaseTimelineInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface GetCaseTimelineDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  /** Opcional: sin el, los eventos salen sin `createdByName` y el cliente muestra el id. */
  readonly assigneeDirectory?: AssigneeDirectory;
}

/**
 * Un evento con el autor ya traducido.
 *
 * El nombre se resuelve aqui y no en el cliente porque el cliente no puede:
 * `GET /organizations/:id` exige PLATFORM_ADMIN, asi que un panel abierto por
 * un analista nunca podra averiguar el nombre de la organizacion que firmo
 * una accion — y esa es la firma habitual, ya que un actor ORGANIZATION
 * estampa el id del inquilino en `CreatedBy`.
 */
export interface TimelineEventWithActor {
  readonly event: CaseTimelineEvent;
  readonly createdByName: string;
  readonly createdByKind: ActorKind;
}

export function createGetCaseTimelineUseCase(deps: GetCaseTimelineDeps) {
  return async function getCaseTimeline(input: GetCaseTimelineInput): Promise<readonly TimelineEventWithActor[]> {
    const caseId = createCaseId(input.caseId);
    const kase = await deps.cases.findById(caseId);
    if (!kase) {
      throw caseNotFound(input.caseId);
    }
    if (input.auth.actorType !== 'PLATFORM_ADMIN' && input.auth.organizationId && kase.organizationId !== input.auth.organizationId) {
      throw forbiddenCrossTenant();
    }
    const events = await deps.timelineRecorder.listByCaseId(input.caseId);

    // `createdBy` nulo significa que nadie firmo el evento: lo genero el
    // propio sistema. Es un caso legitimo, no un fallo de resolucion.
    const SYSTEM_FALLBACK = 'Sistema';

    if (!deps.assigneeDirectory) {
      return events.map((event) => ({
        event,
        createdByName: event.createdBy ?? SYSTEM_FALLBACK,
        createdByKind: (event.createdBy ? 'UNKNOWN' : 'SYSTEM') as ActorKind,
      }));
    }

    // Una sola resolucion por lote para toda la linea de tiempo: un expediente
    // largo repite el mismo autor decenas de veces, y consultarlo por evento
    // convertia una peticion en decenas de idas y venidas.
    const actors = await deps.assigneeDirectory.resolveActors(
      kase.organizationId,
      events.map((event) => event.createdBy).filter((id): id is string => Boolean(id)),
    );
    const byId = new Map(actors.map((actor) => [actor.id, actor]));

    return events.map((event) => {
      if (!event.createdBy) {
        return { event, createdByName: SYSTEM_FALLBACK, createdByKind: 'SYSTEM' as const };
      }
      const actor = byId.get(event.createdBy);
      return {
        event,
        createdByName: actor?.name ?? event.createdBy,
        createdByKind: actor?.kind ?? ('UNKNOWN' as const),
      };
    });
  };
}
