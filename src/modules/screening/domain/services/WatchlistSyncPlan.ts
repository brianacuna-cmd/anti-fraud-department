import type { SanctionedParty } from '../ports/SanctionListFeed.js';
import type {
  SanctionListRecord,
  SyncedEntrySnapshot,
} from '../ports/SyncedWatchlistEntryStore.js';
import type { WatchlistEntryId } from '../model/value-objects/WatchlistEntryId.js';
import { normalizeName } from '../ports/NameNormalizer.js';

const nonEmpty = (value: string): boolean => value.length > 0;

/** Keeps the first record of each `externalRef`, preserving order. */
function firstPerRef(records: readonly SanctionListRecord[]): SanctionListRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const isFirst = !seen.has(record.externalRef);
    seen.add(record.externalRef);
    return isFirst;
  });
}

/**
 * Expands one designated party into watchlist records: one per distinct
 * name, one per identity document, one per wallet address.
 *
 * Separate records rather than one entry carrying arrays, because the
 * candidate query blocks on a single `name` / `document` / `wallet_address`
 * per entry. An alias that is not its own entry is an alias nobody matches.
 *
 * `externalRef` is keyed by the NORMALIZED name, not the alias position: the
 * UK list carries no alias ids, and keying by position would rewrite every
 * entry of a party whenever an alias is inserted above the others.
 */
export function expandSanctionedParty(party: SanctionedParty): SanctionListRecord[] {
  const names = party.names.map((name) => name.trim()).filter((name) => nonEmpty(normalizeName(name)));
  // Chosen by its NORMALIZED form: a "name" that is only punctuation survives
  // a trim, and would otherwise label every document entry of the party "...".
  const primary = names[0];
  if (primary === undefined) return [];

  const base = { entryType: party.entryType, document: null, walletAddress: null, country: party.country };
  const nameRecords = names.map((name) => ({ ...base, externalRef: `${party.uid}|name|${normalizeName(name)}`, name }));
  const documentRecords = party.documents
    .map((document) => document.trim())
    .filter(nonEmpty)
    .map((document) => ({
      ...base,
      externalRef: `${party.uid}|doc|${document.toLowerCase()}`,
      name: primary,
      document,
    }));
  const walletRecords = party.walletAddresses
    .map((address) => address.trim())
    .filter(nonEmpty)
    .map((walletAddress) => ({
      ...base,
      externalRef: `${party.uid}|wallet|${walletAddress.toLowerCase()}`,
      entryType: 'WALLET' as const,
      name: primary,
      walletAddress,
    }));

  return firstPerRef([...nameRecords, ...documentRecords, ...walletRecords]);
}

/**
 * ASCII unit separator. It cannot occur in a name, document or address, so two
 * different field splits can never produce the same fingerprint ("ab"+"" vs
 * "a"+"b"). Built from its code point so the source holds no invisible character.
 */
const FIELD_SEPARATOR = String.fromCharCode(0x1f);

/** Deterministic summary of the fields a sync may change; equal fingerprints mean "leave it alone". */
export function fingerprintRecord(record: SanctionListRecord): string {
  return [record.entryType, record.name, record.document ?? '', record.walletAddress ?? '', record.country ?? ''].join(
    FIELD_SEPARATOR,
  );
}

export interface WatchlistSyncPlan {
  readonly inserts: readonly SanctionListRecord[];
  readonly updates: readonly { readonly id: WatchlistEntryId; readonly record: SanctionListRecord }[];
  readonly removals: readonly WatchlistEntryId[];
  readonly unchanged: number;
}

/**
 * Diffs what an organization holds against what the list now publishes.
 *
 * Unchanged entries are NOT rewritten. That matters beyond saving writes:
 * `updated_at` drives the wallet rescreen's delta scan, so touching every
 * entry on every run would make each nightly rescreen a full rescan.
 */
export function planWatchlistSync(
  existing: readonly SyncedEntrySnapshot[],
  incoming: readonly SanctionListRecord[],
): WatchlistSyncPlan {
  const byRef = new Map(existing.map((snapshot) => [snapshot.externalRef, snapshot]));
  const published = firstPerRef(incoming);
  const publishedRefs = new Set(published.map((record) => record.externalRef));

  const inserts = published.filter((record) => !byRef.has(record.externalRef));
  const known = published.flatMap((record) => {
    const current = byRef.get(record.externalRef);
    return current === undefined ? [] : [{ record, current }];
  });
  // A removed entry that is published again is an update too: it is reactivated.
  const updates = known
    .filter(({ record, current }) => !current.active || current.fingerprint !== fingerprintRecord(record))
    .map(({ record, current }) => ({ id: current.id, record }));
  const removals = existing
    .filter((snapshot) => snapshot.active && !publishedRefs.has(snapshot.externalRef))
    .map((snapshot) => snapshot.id);

  return { inserts, updates, removals, unchanged: known.length - updates.length };
}

/**
 * Above this share of an organization's active entries, a single run may not
 * delist them. Real delistings are a handful a week; losing a fifth of a list
 * overnight means the download was truncated or the schema changed, and
 * applying it would quietly stop screening against thousands of parties.
 */
export const MAX_REMOVAL_RATIO = 0.2;

export type SyncRefusal = 'EMPTY_FEED' | 'TOO_MANY_REMOVALS';

export function refuseUnsafeSync(
  plan: WatchlistSyncPlan,
  incomingCount: number,
  existing: readonly SyncedEntrySnapshot[],
): SyncRefusal | null {
  if (incomingCount === 0) return 'EMPTY_FEED';
  const active = existing.filter((snapshot) => snapshot.active).length;
  if (active > 0 && plan.removals.length / active > MAX_REMOVAL_RATIO) return 'TOO_MANY_REMOVALS';
  return null;
}
