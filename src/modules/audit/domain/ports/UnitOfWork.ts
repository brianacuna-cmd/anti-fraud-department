declare const __tx: unique symbol;

/**
 * Opaque transaction handle, duplicated from `identity-access`'s
 * `UnitOfWork.ts` (design D-A4). The `audit` module never OPENS a
 * transaction itself — it only JOINS the caller's, so it needs no
 * `withTransaction` method, only the marker type threaded through
 * `AuditLogRepository.save`. Both markers are a real Mongo `ClientSession`
 * at runtime; bridged by a single cast at the composition root.
 */
export interface Transaction {
  readonly [__tx]: 'Transaction';
}
