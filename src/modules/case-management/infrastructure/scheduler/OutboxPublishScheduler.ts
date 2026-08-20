import type { PublishOutboxEventsResult } from '../../application/PublishOutboxEvents.js';

export type Sleeper = (ms: number) => Promise<void>;

export interface OutboxPublishSchedulerDeps {
  readonly publishOutboxEvents: () => Promise<PublishOutboxEventsResult>;
  /** Retardo inyectable entre pasadas (en pruebas: FakeSleeper). */
  readonly sleeper?: Sleeper;
  readonly onError?: (error: unknown) => void;
}

export interface OutboxPublishSchedulerHandle {
  stop(): void;
}

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Driver de fondo para `PublishOutboxEvents`.
 *
 * Copia el mismo bucle de sondeo que `SlaSweepScheduler` y
 * `CustomerOutgoingEventDispatcher` —`Sleeper` inyectable, `stop()`, `onError`—
 * en lugar de introducir una dependencia de cron: un intervalo fijo en un solo
 * proceso es todo lo que hace falta, y el repositorio ya tiene ese idiom
 * probado.
 *
 * AVISO DE MULTI-INSTANCIA: a diferencia del barrido de SLA, `findPending` no
 * reclama las filas en exclusiva, asi que dos instancias pueden publicar el
 * mismo evento. La entrega ya es "al menos una vez" por diseno y los
 * consumidores tienen que ser idempotentes, pero conviene arrancar una sola
 * instancia hasta que el repositorio ofrezca un `claim` atomico.
 */
export function createOutboxPublishScheduler(deps: OutboxPublishSchedulerDeps) {
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError =
    deps.onError ??
    ((error: unknown) => {
      console.error('OutboxPublishScheduler error:', error);
    });

  function start(intervalMs: number): OutboxPublishSchedulerHandle {
    let stopped = false;
    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          await deps.publishOutboxEvents();
        } catch (error) {
          onError(error);
        }
        if (stopped) {
          break;
        }
        await sleeper(intervalMs);
      }
    };
    void run();
    return {
      stop(): void {
        stopped = true;
      },
    };
  }

  return { start };
}
