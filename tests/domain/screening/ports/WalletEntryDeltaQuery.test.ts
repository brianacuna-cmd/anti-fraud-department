import type { WalletEntryDeltaQuery, WatchlistEntryRepository } from '../../../../src/modules/screening/domain/ports/WatchlistEntryRepository.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';

const ORG_ID = oid('org-1');
const T_BASE = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const T_AFTER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const T_LATER = fromDate(new Date('2026-01-03T00:00:00.000Z'));

function buildWalletEntry(watchlistId: ReturnType<typeof generateWatchlistId>, updatedAt: ReturnType<typeof fromDate> = T_BASE): WatchlistEntry {
  return WatchlistEntry.rehydrate({
    id: generateWatchlistEntryId(),
    watchlistId,
    organizationId: ORG_ID,
    entryType: 'WALLET',
    name: '0xdeadbeef',
    document: null,
    walletAddress: '0xdeadbeef',
    riskLevel: 'HIGH',
    country: null,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: T_BASE,
    updatedAt,
  });
}

describe('WatchlistEntryRepository — WalletEntryDeltaQuery contract (listActiveWalletEntriesUpdatedSince)', () => {
  it('listActiveWalletEntriesUpdatedSince exists on the WatchlistEntryRepository interface', () => {
    const repo: WatchlistEntryRepository = new InMemoryWatchlistEntryRepository();
    expect(typeof repo.listActiveWalletEntriesUpdatedSince).toBe('function');
  });

  it('returns entries updated after updatedSince, sorted ASC by updatedAt', async () => {
    const repo: WatchlistEntryRepository = new InMemoryWatchlistEntryRepository();
    const watchlistId = generateWatchlistId();

    const oldEntry = buildWalletEntry(watchlistId, T_BASE);
    const newEntry = buildWalletEntry(watchlistId, T_AFTER);
    const newerEntry = buildWalletEntry(watchlistId, T_LATER);

    await repo.create(oldEntry);
    await repo.create(newEntry);
    await repo.create(newerEntry);

    const query: WalletEntryDeltaQuery = {
      organizationId: ORG_ID,
      watchlistIds: [watchlistId],
      updatedSince: T_BASE,
      limit: 10,
    };
    const results = await repo.listActiveWalletEntriesUpdatedSince(query);

    expect(results).toHaveLength(2);
    expect(results[0]?.updatedAt).toBe(T_AFTER);
    expect(results[1]?.updatedAt).toBe(T_LATER);
  });

  it('returns all entries when updatedSince is null (backfill from epoch)', async () => {
    const repo: WatchlistEntryRepository = new InMemoryWatchlistEntryRepository();
    const watchlistId = generateWatchlistId();

    await repo.create(buildWalletEntry(watchlistId, T_BASE));
    await repo.create(buildWalletEntry(watchlistId, T_AFTER));

    const query: WalletEntryDeltaQuery = {
      organizationId: ORG_ID,
      watchlistIds: [watchlistId],
      updatedSince: null,
      limit: 10,
    };
    const results = await repo.listActiveWalletEntriesUpdatedSince(query);

    expect(results).toHaveLength(2);
  });
});
