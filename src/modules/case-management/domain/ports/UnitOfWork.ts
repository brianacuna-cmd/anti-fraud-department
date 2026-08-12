declare const __tx: unique symbol;

/**
 * Opaque transaction handle (mirrors identity-access's `UnitOfWork` port).
 * Domain/application code never inspects it — it exists only to be threaded
 * through to a repository call that needs it, or ignored entirely.
 */
export interface Transaction {
  readonly [__tx]: 'Transaction';
}

/**
 * Port for atomic multi-step work. The Mongo adapter (`MongoUnitOfWork`)
 * casts the opaque `Transaction` back to a `ClientSession` and drives
 * `session.withTransaction`; domain/application code only ever sees this
 * interface.
 */
export interface UnitOfWork {
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
