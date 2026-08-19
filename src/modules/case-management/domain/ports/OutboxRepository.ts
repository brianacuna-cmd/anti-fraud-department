import type { OutboxEvent } from '../model/aggregates/OutboxEvent.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Puerto del outbox transaccional.
 *
 * `record` escribe el evento DENTRO de la transaccion que produjo el hecho —
 * es lo que garantiza que no exista un caso creado sin su evento, ni un evento
 * sin su caso. `findPending` y `save` son el otro extremo: los usa el
 * publicador, que corre fuera de esa transaccion.
 */
export interface OutboxRepository {
  record(event: OutboxEvent, tx?: Transaction): Promise<void>;
  /** Eventos aun sin despachar, del mas antiguo al mas reciente. */
  findPending(limit?: number, tx?: Transaction): Promise<readonly OutboxEvent[]>;
  save(event: OutboxEvent, tx?: Transaction): Promise<void>;
}
