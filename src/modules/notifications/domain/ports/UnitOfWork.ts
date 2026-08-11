declare const __tx: unique symbol;

/**
 * Opaque transaction handle (design D3, copied from identity-access's own
 * `UnitOfWork.ts`). Domain/application code never inspects it — it exists
 * only to be threaded through to a repository/audit-recorder call that needs
 * it. Same nominal-typing idiom as `shared/kernel/Brand.ts`, applied to a
 * type with no underlying primitive. This module owns its own brand (a
 * module may not import another module's domain types — eslint `boundaries`).
 */
export interface Transaction {
  readonly [__tx]: 'Transaction';
}

/**
 * Port for atomic multi-step work (design D3/D11). The Mongo adapter
 * (`MongoUnitOfWork`, PR2/PR3) casts the opaque `Transaction` back to a
 * `ClientSession` and drives `session.withTransaction`; domain/application
 * code only ever sees this interface.
 */
export interface UnitOfWork {
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
