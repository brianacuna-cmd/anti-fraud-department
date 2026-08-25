/**
 * Locally materialized Finturu customer directory.
 *
 * This is not a domain aggregate: it is a read copy of data that lives in
 * Bridge/Stripe. It exists because walking those APIs live costs minutes
 * (measured: ~3 min for the full register), which makes composing the
 * directory on every request unviable. Sync refreshes it in batches; screens
 * read from here.
 *
 * **Not partitioned by organization.** Behind it there is a single Bridge
 * account, so the register is the same no matter where you look; giving it an
 * `OrganizationId` only duplicated rows and opened the door for sync to write
 * under one organization and the screen to read under another. What IS per
 * organization is the join with cases, and that lives in `Cases`.
 *
 * Deliberately separate from `Cases`: a monitored customer is not a fraud
 * case. Mixing them would turn the 1400+ customers in the register into
 * open cases.
 */

export interface FinturuDirectoryEntry {
  readonly idUser: string;
  readonly idUserBridge: string | null;
  readonly name: string | null;
  readonly lastname: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string | null;
  readonly address: string | null;
  readonly idCustomer: string | null;
  readonly wallets: readonly unknown[];
  readonly transfers: readonly unknown[];
  readonly stripe: Record<string, unknown> | null;
  readonly riskScore: number;
}

export interface FinturuDirectoryQuery {
  readonly limit: number;
  readonly offset: number;
  /** Search by name, email, phone, identifiers, or wallet address. */
  readonly search?: string;
}

export interface FinturuDirectoryPage {
  readonly items: readonly FinturuDirectoryEntry[];
  /** Total customers matching the filter, so pagination is real. */
  readonly total: number;
  /** When the directory was last refreshed; `null` if never. */
  readonly syncedAt: string | null;
}

export interface FinturuDirectoryRepository {
  /**
   * Replaces the directory. Customers that no longer come in the batch are
   * removed, so a deletion at the source disappears from here.
   */
  replaceAll(entries: readonly FinturuDirectoryEntry[], syncedAt: string): Promise<void>;

  page(query: FinturuDirectoryQuery): Promise<FinturuDirectoryPage>;

  lastSyncedAt(): Promise<string | null>;
}
