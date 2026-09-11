import type { EntryType } from '../model/value-objects/EntryType.js';
import type { SanctionSource } from '../model/value-objects/SanctionSource.js';

/**
 * One designated party exactly as an official list publishes it, before it
 * is expanded into watchlist entries (one per name, document and wallet).
 */
export interface SanctionedParty {
  /** The list's own identifier: OFAC `uid`, EU `logicalId`, UK `UniqueID`. */
  readonly uid: string;
  readonly entryType: Exclude<EntryType, 'WALLET'>;
  /** Primary name first, then the aliases the list rates as reliable. */
  readonly names: readonly string[];
  readonly documents: readonly string[];
  readonly walletAddresses: readonly string[];
  readonly country: string | null;
}

/**
 * Outbound port — downloads and parses one official sanctions list.
 *
 * Implementations throw on transport failure. A list that downloads but
 * parses to nothing (a maintenance page served with HTTP 200, a schema
 * change) comes back as an empty array, and the sync refuses to apply it
 * rather than delisting every party.
 */
export interface SanctionListFeed {
  readonly source: SanctionSource;
  fetchParties(): Promise<readonly SanctionedParty[]>;
}
