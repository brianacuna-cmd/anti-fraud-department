/**
 * Outbound port — read-only wallet universe for the rescreen use case.
 *
 * The composition-root bridge implements this via `FinturuDirectoryRepository`
 * and a runtime type guard that narrows `readonly unknown[]` per element,
 * logging any entries that fail the shape check so drift is visible rather
 * than silent (D4).
 *
 * Addresses are delivered already trim+lowercased by the bridge so the use
 * case can do a direct string comparison without further normalization.
 */
export interface FinturuWalletHolder {
  /** Finturu customer identifier corresponding to the case-management customerId. */
  readonly customerId: string;
  /** All wallet addresses held by this customer, already trimmed and lowercased. */
  readonly walletAddresses: readonly string[];
}

export interface FinturuWalletSource {
  /**
   * Streams all active wallet holders in batches of at most `batchSize`
   * elements. Implementations are responsible for pagination and MUST yield
   * every holder exactly once per call.
   */
  streamHolders(batchSize: number): AsyncIterable<FinturuWalletHolder>;
}
