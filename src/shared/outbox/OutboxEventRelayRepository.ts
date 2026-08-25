import type { OutboxEvent } from './OutboxEvent.js';

/**
 * Lado lector del outbox transaccional, el que usa el relay.
 *
 * Va aparte de `OutboxEventRepository` a proposito: ese puerto lo implementan
 * decenas de dobles de prueba que solo necesitan escribir dentro de una
 * transaccion, y anadirles un `findPending` que jamas llaman solo servriria
 * para romperlos. El relay corre FUERA de la transaccion de negocio, asi que
 * tampoco comparte sus necesidades.
 */
export interface OutboxEventRelayRepository {
  /** Eventos aun sin despachar, del mas antiguo al mas reciente. */
  findPending(limit?: number, tx?: unknown): Promise<readonly OutboxEvent[]>;
  /**
   * Persiste el desenlace de un intento sobre una fila que ya existe. Es un
   * metodo distinto de `save` porque aquel inserta —el outbox es append-only en
   * el camino de escritura— y aqui siempre se actualiza.
   */
  update(event: OutboxEvent, tx?: unknown): Promise<void>;
}
