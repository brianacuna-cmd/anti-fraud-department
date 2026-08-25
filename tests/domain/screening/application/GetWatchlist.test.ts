import { oid } from '../../../support/oid.js';
import { createGetWatchlistUseCase } from '../../../../src/modules/screening/application/GetWatchlist.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

describe('createGetWatchlistUseCase', () => {
  it('returns a watchlist belonging to the caller org', async () => {
    const watchlistRepository = new InMemoryWatchlistRepository();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_1,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);
    const getWatchlist = createGetWatchlistUseCase({ watchlistRepository });

    const result = await getWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') });

    expect(result.id).toBe(watchlist.id);
  });

  it('404s for a watchlist belonging to another org', async () => {
    const watchlistRepository = new InMemoryWatchlistRepository();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_2,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);
    const getWatchlist = createGetWatchlistUseCase({ watchlistRepository });

    await expect(
      getWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });
  });

  it('404s for a nonexistent id', async () => {
    const watchlistRepository = new InMemoryWatchlistRepository();
    const getWatchlist = createGetWatchlistUseCase({ watchlistRepository });

    await expect(
      getWatchlist({ auth: ANALYST, watchlistId: oid('nonexistent') }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });
  });
});
