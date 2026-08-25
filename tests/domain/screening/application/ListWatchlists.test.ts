import { oid } from '../../../support/oid.js';
import { createListWatchlistsUseCase } from '../../../../src/modules/screening/application/ListWatchlists.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

function seed(repo: InMemoryWatchlistRepository, organizationId: string, name: string, type: 'BLACKLIST' | 'WHITELIST', status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  const watchlist = Watchlist.create({
    id: generateWatchlistId(),
    organizationId,
    name,
    source: 'OFAC',
    type,
    now: NOW,
  });
  const finalWatchlist = status === 'INACTIVE' ? watchlist.softDelete(NOW) : watchlist;
  void repo.create(finalWatchlist);
}

describe('createListWatchlistsUseCase', () => {
  it('returns only the caller org watchlists', async () => {
    const watchlistRepository = new InMemoryWatchlistRepository();
    seed(watchlistRepository, ORG_1, 'A', 'BLACKLIST');
    seed(watchlistRepository, ORG_1, 'B', 'BLACKLIST');
    seed(watchlistRepository, ORG_1, 'C', 'BLACKLIST');
    seed(watchlistRepository, ORG_2, 'D', 'BLACKLIST');
    seed(watchlistRepository, ORG_2, 'E', 'BLACKLIST');
    const listWatchlists = createListWatchlistsUseCase({ watchlistRepository });

    const result = await listWatchlists({ auth: ANALYST, limit: 10, offset: 0 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
  });

  it('returns an empty page with the correct total beyond the last page', async () => {
    const watchlistRepository = new InMemoryWatchlistRepository();
    seed(watchlistRepository, ORG_1, 'A', 'BLACKLIST');
    seed(watchlistRepository, ORG_1, 'B', 'BLACKLIST');
    seed(watchlistRepository, ORG_1, 'C', 'BLACKLIST');
    const listWatchlists = createListWatchlistsUseCase({ watchlistRepository });

    const result = await listWatchlists({ auth: ANALYST, limit: 10, offset: 10 });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(3);
  });

  it('filters by type and status', async () => {
    const watchlistRepository = new InMemoryWatchlistRepository();
    seed(watchlistRepository, ORG_1, 'A', 'BLACKLIST', 'ACTIVE');
    seed(watchlistRepository, ORG_1, 'B', 'WHITELIST', 'INACTIVE');
    const listWatchlists = createListWatchlistsUseCase({ watchlistRepository });

    const result = await listWatchlists({
      auth: ANALYST,
      type: ['BLACKLIST'],
      status: ['ACTIVE'],
      limit: 10,
      offset: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('A');
  });
});
