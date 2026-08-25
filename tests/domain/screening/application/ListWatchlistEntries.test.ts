import { oid } from '../../../support/oid.js';
import { createListWatchlistEntriesUseCase } from '../../../../src/modules/screening/application/ListWatchlistEntries.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

function buildUseCase() {
  const watchlistRepository = new InMemoryWatchlistRepository();
  const watchlistEntryRepository = new InMemoryWatchlistEntryRepository();
  const listWatchlistEntries = createListWatchlistEntriesUseCase({ watchlistRepository, watchlistEntryRepository });
  return { watchlistRepository, watchlistEntryRepository, listWatchlistEntries };
}

describe('createListWatchlistEntriesUseCase', () => {
  it('returns entries for a same-org watchlist with correct total', async () => {
    const { watchlistRepository, watchlistEntryRepository, listWatchlistEntries } = buildUseCase();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: generateWatchlistEntryId(), watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Alice', now: NOW }),
    );
    await watchlistEntryRepository.create(
      WatchlistEntry.create({ id: generateWatchlistEntryId(), watchlistId, organizationId: ORG_1, entryType: 'PERSON', name: 'Bob', now: NOW }),
    );

    const result = await listWatchlistEntries({ auth: ANALYST, watchlistId: oid('watchlist-1'), limit: 10, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('returns 404 when the watchlist belongs to another org', async () => {
    const { watchlistRepository, listWatchlistEntries } = buildUseCase();
    await watchlistRepository.create(
      Watchlist.create({
        id: createWatchlistId(oid('watchlist-1')),
        organizationId: ORG_2,
        name: 'EU',
        source: 'EU',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );

    await expect(
      listWatchlistEntries({ auth: ANALYST, watchlistId: oid('watchlist-1'), limit: 10, offset: 0 }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });
  });

  it('returns 404 when the watchlist does not exist', async () => {
    const { listWatchlistEntries } = buildUseCase();

    await expect(
      listWatchlistEntries({ auth: ANALYST, watchlistId: oid('nonexistent'), limit: 10, offset: 0 }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });
  });
});
