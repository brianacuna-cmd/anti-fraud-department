declare const __tx: unique symbol;

/**
 * Opaque transaction handle (mirrors case-management / identity-access).
 * Domain/application code never inspects it — it exists only to be threaded
 * through to a repository call that needs it.
 */
export interface Transaction {
  readonly [__tx]: 'Transaction';
}

/**
 * Port for atomic multi-step work. `OpenAmlAlert` writes `aml_alerts`,
 * `case_timeline`, and `outbox_events` inside one `withTransaction`.
 */
export interface UnitOfWork {
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
