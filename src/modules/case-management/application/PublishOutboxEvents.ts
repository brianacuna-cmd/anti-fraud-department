import type { Clock } from '../../../shared/time/Clock.js';
import type { OutboxEventRelayRepository } from '../../../shared/outbox/OutboxEventRelayRepository.js';
import type { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';

/**
 * Destino de un evento ya confirmado.
 *
 * Se declara como puerto y no como una llamada HTTP concreta porque a dia de
 * hoy no hay ningun consumidor decidido: dejarlo abstracto permite despachar a
 * un log mientras se decide, y cambiar a una cola o a un webhook sin tocar el
 * publicador.
 */
export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export interface PublishOutboxEventsResult {
  readonly published: number;
  readonly failed: number;
}

export interface PublishOutboxEventsDeps {
  readonly outbox: OutboxEventRelayRepository;
  readonly publisher: OutboxPublisher;
  readonly clock: Clock;
  readonly batchSize?: number;
}

/**
 * Despacha los eventos que la transaccion dejo en PENDING.
 *
 * Hasta ahora el patron estaba montado a medias: los eventos se escribian en
 * la misma transaccion que el caso —que es la parte dificil y la que garantiza
 * que no se pierdan— pero nadie los sacaba, asi que se acumulaban en PENDING
 * indefinidamente.
 *
 * Entrega **al menos una vez**, no exactamente una: si el proceso muere entre
 * publicar y marcar, el evento se reintentara. Es la garantia correcta para un
 * outbox — la alternativa (marcar antes de publicar) perderia eventos en
 * silencio, que es mucho peor que entregar uno repetido. Los consumidores
 * tienen que ser idempotentes, y `aggregateId` + `eventType` les da con que.
 *
 * Un fallo individual marca ese evento como FAILED con su motivo y el barrido
 * continua: un consumidor que rechaza un payload concreto no puede bloquear la
 * cola entera detras de el.
 */
export function createPublishOutboxEventsUseCase(deps: PublishOutboxEventsDeps) {
  return async function publishOutboxEvents(): Promise<PublishOutboxEventsResult> {
    const pending = await deps.outbox.findPending(deps.batchSize ?? 100);

    let published = 0;
    let failed = 0;

    for (const event of pending) {
      try {
        await deps.publisher.publish(event);
        await deps.outbox.update(event.markPublished(deps.clock.now()));
        published += 1;
      } catch (error) {
        const reason = (error as Error).message;
        console.warn(`[outbox] fallo al publicar ${event.eventType} (${event.id}): ${reason}`);
        try {
          await deps.outbox.update(event.markFailed(reason));
        } catch {
          // Si ni siquiera se puede anotar el fallo, se deja en PENDING: el
          // proximo pase lo reintentara, que es preferible a perderlo.
        }
        failed += 1;
      }
    }

    return { published, failed };
  };
}

/**
 * Publicador por defecto: deja constancia en el log.
 *
 * No es un marcador de posicion vacio — mientras no exista un consumidor real,
 * este deja rastro auditable de que el evento salio y cuando, en lugar de que
 * los eventos se queden atascados en PENDING sin que nadie lo note.
 */
export function createLogOutboxPublisher(): OutboxPublisher {
  return {
    async publish(event: OutboxEvent): Promise<void> {
      console.info(
        `[outbox] ${event.eventType} ${event.aggregateType}:${event.aggregateId} ${JSON.stringify(event.payload)}`,
      );
    },
  };
}

export type PublishOutboxEventsService = ReturnType<typeof createPublishOutboxEventsUseCase>;
