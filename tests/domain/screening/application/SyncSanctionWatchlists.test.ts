import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { SanctionSource } from '../../../../src/modules/screening/domain/model/value-objects/SanctionSource.js';
import { SANCTION_WATCHLIST_NAMES } from '../../../../src/modules/screening/domain/model/value-objects/SanctionSource.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import { referenceNameNormalizer } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';
import type { SanctionListFeed, SanctionedParty } from '../../../../src/modules/screening/domain/ports/SanctionListFeed.js';
import type {
  SyncedEntrySnapshot,
  SyncedWatchlistEntryStore,
  WatchlistSyncChange,
} from '../../../../src/modules/screening/domain/ports/SyncedWatchlistEntryStore.js';
import {
  SANCTION_ENTRY_RISK_LEVEL,
  createSyncSanctionWatchlistsUseCase,
} from '../../../../src/modules/screening/application/SyncSanctionWatchlists.js';

const ORG_A = oid('org-a');
const ORG_B = oid('org-b');
const NOW = fromDate(new Date('2026-09-11T04:00:00.000Z'));

class FakeFeed implements SanctionListFeed {
  constructor(
    readonly source: SanctionSource,
    public parties: readonly SanctionedParty[] | Error,
  ) {}

  async fetchParties(): Promise<readonly SanctionedParty[]> {
    if (this.parties instanceof Error) throw this.parties;
    return this.parties;
  }
}

interface StoredEntry extends SyncedEntrySnapshot {
  readonly watchlistId: string;
  readonly change: WatchlistSyncChange;
  readonly name: string;
  readonly normalizedName: string;
}

class FakeStore implements SyncedWatchlistEntryStore {
  readonly entries = new Map<string, StoredEntry>();

  async listSnapshots(watchlistId: string): Promise<readonly SyncedEntrySnapshot[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.watchlistId === watchlistId)
      .map(({ id, externalRef, fingerprint, active }) => ({ id, externalRef, fingerprint, active }));
  }

  async apply(change: WatchlistSyncChange): Promise<void> {
    for (const write of [...change.inserts, ...change.updates]) {
      this.entries.set(String(write.id), {
        id: write.id,
        externalRef: write.record.externalRef,
        fingerprint: write.fingerprint,
        active: true,
        watchlistId: String(change.watchlistId),
        change,
        name: write.record.name,
        normalizedName: write.indexed.normalizedName,
      });
    }
    for (const id of change.removals) {
      const entry = this.entries.get(String(id));
      if (entry !== undefined) this.entries.set(String(id), { ...entry, active: false });
    }
  }

  readonly syncedAt = new Map<string, string>();

  async recordSync(watchlistId: string, now: string): Promise<void> {
    this.syncedAt.set(watchlistId, now);
  }

  active(): StoredEntry[] {
    return [...this.entries.values()].filter((entry) => entry.active);
  }

  idOf(externalRef: string): WatchlistEntryId | undefined {
    return [...this.entries.values()].find((entry) => entry.externalRef === externalRef)?.id;
  }
}

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

const party = (uid: string, overrides: Partial<SanctionedParty> = {}): SanctionedParty => ({
  uid,
  entryType: 'PERSON',
  names: [`Party ${uid}`],
  documents: [],
  walletAddresses: [],
  country: null,
  ...overrides,
});
const parties = (count: number) => Array.from({ length: count }, (_, i) => party(String(i + 1)));

function build(feeds: SanctionListFeed[], organizationIds: string[] = [ORG_A]) {
  const watchlists = new InMemoryWatchlistRepository();
  const store = new FakeStore();
  const audit = new RecordingAuditRecorder();
  const sync = createSyncSanctionWatchlistsUseCase({
    feeds,
    organizations: { listActiveOrganizationIds: async () => organizationIds },
    watchlistRepository: watchlists,
    store,
    nameNormalizer: referenceNameNormalizer,
    phoneticEncoder: { encode: (token) => [token.toUpperCase()] },
    auditRecorder: audit,
    clock: new FixedClock(NOW),
    generateWatchlistId,
    generateWatchlistEntryId,
  });
  return { sync, watchlists, store, audit };
}

describe('SyncSanctionWatchlists (AML-001)', () => {
  it('creates the official BLACKLIST in every active organization and fills it, CRITICAL and indexed', async () => {
    const { sync, watchlists, store, audit } = build([new FakeFeed('OFAC_SDN', parties(3))], [ORG_A, ORG_B]);

    const [outcome] = await sync();

    expect(outcome!.organizations.map((o) => [o.organizationId, o.inserted])).toEqual([
      [ORG_A, 3],
      [ORG_B, 3],
    ]);
    expect(watchlists.all().map((w) => [w.organizationId, w.name, w.source, w.type])).toEqual([
      [ORG_A, SANCTION_WATCHLIST_NAMES.OFAC_SDN, 'OFAC_SDN', 'BLACKLIST'],
      [ORG_B, SANCTION_WATCHLIST_NAMES.OFAC_SDN, 'OFAC_SDN', 'BLACKLIST'],
    ]);
    expect(store.active()).toHaveLength(6);
    expect(store.active()[0]!.change.riskLevel).toBe(SANCTION_ENTRY_RISK_LEVEL);
    // Written searchable: the blocking fields come with the insert, not in a second pass.
    expect(store.active()[0]!.normalizedName).toBe('party 1');
    expect(audit.events.map((e) => [e.organizationId, e.action])).toEqual([
      [ORG_A, 'SYNC_SANCTION_WATCHLIST'],
      [ORG_B, 'SYNC_SANCTION_WATCHLIST'],
    ]);
  });

  it('writes nothing when the list has not changed, and still leaves an audit row', async () => {
    const { sync, store, audit } = build([new FakeFeed('OFAC_SDN', parties(3))]);
    await sync();
    const idsBefore = store.active().map((e) => e.id);

    const [second] = await sync();

    expect(second!.organizations[0]).toEqual(
      expect.objectContaining({ inserted: 0, updated: 0, removed: 0, unchanged: 3, refused: null }),
    );
    expect(store.active().map((e) => e.id)).toEqual(idsBefore);
    expect(audit.events).toHaveLength(2);
  });

  it('updates a changed party in place, under the same entry id', async () => {
    const feed = new FakeFeed('OFAC_SDN', parties(3));
    const { sync, store } = build([feed]);
    await sync();
    const id = store.idOf('1|name|party 1');

    feed.parties = [party('1', { country: 'Cuba' }), party('2'), party('3')];
    const [outcome] = await sync();

    expect(outcome!.organizations[0]!.updated).toBe(1);
    expect(store.idOf('1|name|party 1')).toBe(id);
  });

  it('removes a delisted party and reactivates the same entry when it is listed again', async () => {
    const feed = new FakeFeed('OFAC_SDN', parties(10));
    const { sync, store } = build([feed]);
    await sync();
    const id = store.idOf('10|name|party 10');

    feed.parties = parties(9);
    const [delisted] = await sync();
    expect(delisted!.organizations[0]!.removed).toBe(1);
    expect(store.active()).toHaveLength(9);

    feed.parties = parties(10);
    const [relisted] = await sync();
    expect(relisted!.organizations[0]).toEqual(expect.objectContaining({ inserted: 0, updated: 1 }));
    expect(store.active().find((e) => e.id === id)).toBeDefined();
  });

  it('refuses to delist a large share at once, applies nothing, and fails the run', async () => {
    const feed = new FakeFeed('OFAC_SDN', parties(10));
    const { sync, store, audit } = build([feed]);
    await sync();

    feed.parties = parties(7);

    await expect(sync()).rejects.toThrow(/OFAC_SDN in organization .*: TOO_MANY_REMOVALS/);
    expect(store.active()).toHaveLength(10);
    expect(audit.events.at(-1)!.detail).toEqual(expect.objectContaining({ refused: 'TOO_MANY_REMOVALS', removed: 3 }));
  });

  it('refuses an empty download instead of emptying the list', async () => {
    const feed = new FakeFeed('EU_FSF', parties(5));
    const { sync, store } = build([feed]);
    await sync();

    feed.parties = [];

    await expect(sync()).rejects.toThrow(/EMPTY_FEED/);
    expect(store.active()).toHaveLength(5);
  });

  it('keeps syncing the other lists when one fails to download', async () => {
    const { sync, store } = build([
      new FakeFeed('OFAC_SDN', new Error('download failed with HTTP 503')),
      new FakeFeed('EU_FSF', parties(2)),
    ]);

    await expect(sync()).rejects.toThrow(/OFAC_SDN: download failed with HTTP 503/);
    expect(store.active()).toHaveLength(2);
  });

  it('never adopts a watchlist of the tenant that only shares the reserved name', async () => {
    const { sync, watchlists, store } = build([new FakeFeed('OFAC_SDN', parties(2))]);
    await watchlists.create(
      Watchlist.create({
        id: generateWatchlistId(),
        organizationId: ORG_A,
        name: SANCTION_WATCHLIST_NAMES.OFAC_SDN,
        source: 'MANUAL',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );

    await expect(sync()).rejects.toThrow(/NAME_TAKEN/);
    expect(store.active()).toHaveLength(0);
  });

  it('stamps the list as synced when a run is applied, even one with no changes', async () => {
    const { sync, store, watchlists } = build([new FakeFeed('OFAC_SDN', parties(3))]);
    await sync();
    const id = String(watchlists.all()[0]!.id);
    store.syncedAt.clear();

    await sync();

    expect(store.syncedAt.get(id)).toBe(NOW);
  });

  it('keeps the previous date when a run is refused, so a stale list looks stale', async () => {
    const feed = new FakeFeed('OFAC_SDN', parties(10));
    const { sync, store, watchlists } = build([feed]);
    await sync();
    const id = String(watchlists.all()[0]!.id);
    store.syncedAt.clear();

    feed.parties = parties(7);
    await expect(sync()).rejects.toThrow(/TOO_MANY_REMOVALS/);

    expect(store.syncedAt.has(id)).toBe(false);
  });
});
