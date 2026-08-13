declare const __tx: unique symbol;

/**
 * Opaque transaction handle (mirrors case-management's `UnitOfWork` port).
 * The scoring use case does not call `withTransaction` (read + audit only);
 * the port still exists so adapters and later mutating flows can thread it.
 */
export interface Transaction {
  readonly [__tx]: 'Transaction';
}

export interface UnitOfWork {
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
