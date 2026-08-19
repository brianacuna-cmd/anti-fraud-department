import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../shared/time/Instant.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { Notifier } from '../domain/ports/Notifier.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';

/**
 * Antelacion con la que se avisa de un vencimiento proximo. Un aviso que llega
 * en el mismo instante del vencimiento no es un aviso, es un parte de bajas.
 */
const WARNING_LEAD_MINUTES = 30;

export interface SweepCaseSlaResult {
  readonly examined: number;
  readonly warned: number;
  readonly breached: number;
}

export interface SweepCaseSlaDeps {
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly notifier?: Notifier;
}

/** `dueDate - WARNING_LEAD_MINUTES`, el instante a partir del cual toca avisar. */
function warningThreshold(now: Instant): Instant {
  return fromDate(new Date(toDate(now).getTime() + WARNING_LEAD_MINUTES * 60_000));
}

/**
 * Cierra el circuito del SLA: hasta ahora el reloj arrancaba pero nadie miraba
 * si vencia.
 *
 * `CaseSlaTracking` nacia en ON_TRACK con su fecha limite y ahi se quedaba
 * para siempre: nada lo pasaba a WARNING ni a BREACHED, de modo que el estado
 * era decorativo y el unico vencimiento observable era el que un analista
 * quisiera ir a buscar con un filtro. Este barrido es lo que convierte el SLA
 * de dato en control.
 *
 * Avanza cada fila UNA sola casilla por pase, respetando la tabla de
 * transiciones (ON_TRACK -> WARNING -> BREACHED, sin marcha atras). Un caso
 * que lleva vencido desde ayer pasa por WARNING en un pase y a BREACHED en el
 * siguiente, en vez de saltarselo: cada peldano deja su asiento en la linea de
 * tiempo, y saltarlos borraria la evidencia de que el aviso llego a emitirse.
 *
 * Nunca lanza: un fallo al procesar una fila se registra y el barrido sigue
 * con las demas. Un unico caso corrupto no puede dejar sin vigilancia al resto.
 */
export function createSweepCaseSlaUseCase(deps: SweepCaseSlaDeps) {
  return async function sweepCaseSla(): Promise<SweepCaseSlaResult> {
    const now = deps.clock.now();

    // El repositorio ya excluye las filas BREACHED: una vez incumplido, no hay
    // nada mas que decir hasta que alguien reabra o resuelva el caso.
    const dueForSweep = await deps.slaTracking.findDueForSweep(warningThreshold(now));

    let warned = 0;
    let breached = 0;

    for (const tracking of dueForSweep) {
      try {
        const isOverdue = tracking.dueDate <= now;
        const nextStatus =
          tracking.status === 'ON_TRACK' ? 'WARNING' : isOverdue ? 'BREACHED' : null;

        // Ya esta en WARNING y aun no ha vencido: no hay peldano que subir.
        if (nextStatus === null) continue;
        // Todavia no ha vencido y solo estamos avisando: correcto.
        if (nextStatus === 'BREACHED' && !isOverdue) continue;

        const advanced = tracking.advanceTo(nextStatus, now);
        await deps.slaTracking.save(advanced);

        await deps.timelineRecorder.record(
          CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: tracking.caseId,
            eventType: nextStatus === 'WARNING' ? 'SLA_INITIALIZED' : 'SLA_BREACHED',
            previousValue: tracking.status,
            newValue: nextStatus,
            createdBy: 'SYSTEM_SYNC',
            createdAt: now,
          }),
        );

        if (nextStatus === 'WARNING') warned += 1;
        else breached += 1;

        // El aviso necesita saber a quien: se lee el caso para conocer su
        // responsable. Un caso sin asignar no tiene a quien avisar — y eso es
        // precisamente lo que el contador de este resultado deja ver.
        if (deps.notifier) {
          const kase = await deps.cases.findById(tracking.caseId);
          if (kase?.assignedTo?.type === 'USER') {
            await deps.notifier.notify({
              organizationId: kase.organizationId,
              recipientUserId: kase.assignedTo.id,
              alertType: 'SLA_POR_VENCER',
              title: nextStatus === 'WARNING' ? 'Un caso esta por vencer' : 'Un caso ha incumplido su plazo',
              body:
                nextStatus === 'WARNING'
                  ? `El caso ${kase.id} vence el ${tracking.dueDate}.`
                  : `El caso ${kase.id} supero su plazo (vencia el ${tracking.dueDate}).`,
              resourceType: 'case',
              resourceId: kase.id,
            });
          }
        }
      } catch (error) {
        console.warn(
          `[sla-sweep] no se pudo procesar el caso ${tracking.caseId}: ${(error as Error).message}`,
        );
      }
    }

    return { examined: dueForSweep.length, warned, breached };
  };
}

export type SweepCaseSlaService = ReturnType<typeof createSweepCaseSlaUseCase>;
