declare const __tx: unique symbol;

/**
 * Opaque transaction handle (design D6). Domain/application code never
 * inspects it — it exists only to be threaded through to a repository call
 * that needs it, or ignored entirely (Phase 2's single-aggregate use cases).
 * Same nominal-typing idiom as `shared/kernel/Brand.ts`, applied to a type
 * with no underlying primitive.
 */
export interface Transaction {
  readonly [__tx]: 'Transaction';
}

/**
 * Port for atomic multi-step work (design D6). The Mongo adapter
 * (`MongoUnitOfWork`, Phase 3) casts the opaque `Transaction` back to a
 * `ClientSession` and drives `session.withTransaction`; domain/application
 * code only ever sees this interface.
 */
export interface UnitOfWork {
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
