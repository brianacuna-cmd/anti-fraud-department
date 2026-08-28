declare const __tx: unique symbol;

/** Opaque transaction handle (mirrors risk-assessment/case-management's `UnitOfWork` port). */
export interface Transaction {
  readonly [__tx]: 'Transaction';
}

export interface UnitOfWork {
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
