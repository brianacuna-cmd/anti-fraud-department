import { oid } from '../../../support/oid.js';
import type { WatchlistRepository } from '../../../../src/modules/screening/domain/ports/WatchlistRepository.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildWatchlist(overrides: { organizationId?: string; name?: string; type?: 'BLACKLIST' | 'WHITELIST' } = {}): Watchlist {
  return Watchlist.create({
    id: generateWatchlistId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    name: overrides.name ?? 'Global Sanctions',
    source: 'OFAC',
    type: overrides.type ?? 'BLACKLIST',
    now: NOW,
  });
}

describe('WatchlistRepository (port contract shape)', () => {
  it('an implementation can create and re-fetch a watchlist by id', async () => {
    const repository: WatchlistRepository = new InMemoryWatchlistRepository();
    const watchlist = buildWatchlist();

    await repository.create(watchlist);
    const found = await repository.findById(watchlist.id);

    expect(found?.id).toBe(watchlist.id);
  });

  it('save persists an update', async () => {
    const repository = new InMemoryWatchlistRepository();
    const watchlist = buildWatchlist();
    await repository.create(watchlist);

    await repository.save(watchlist.update({ name: 'Renamed' }, NOW));

    const found = await repository.findById(watchlist.id);
    expect(found?.name).toBe('Renamed');
  });

  it('findByNameForOrg matches within org and excludes soft-deleted', async () => {
    const repository = new InMemoryWatchlistRepository();
    const watchlist = buildWatchlist({ organizationId: oid('org-1'), name: 'Global Sanctions' });
    await repository.create(watchlist);

    await expect(repository.findByNameForOrg(oid('org-1'), 'Global Sanctions')).resolves.not.toBeNull();
    await expect(repository.findByNameForOrg(oid('org-2'), 'Global Sanctions')).resolves.toBeNull();

    await repository.save(watchlist.softDelete(NOW));
    await expect(repository.findByNameForOrg(oid('org-1'), 'Global Sanctions')).resolves.toBeNull();
  });

  it('list scopes by org, filters by type/status, and paginates with total', async () => {
    const repository = new InMemoryWatchlistRepository();
    const a = buildWatchlist({ organizationId: oid('org-1'), name: 'A', type: 'BLACKLIST' });
    const b = buildWatchlist({ organizationId: oid('org-1'), name: 'B', type: 'WHITELIST' });
    const other = buildWatchlist({ organizationId: oid('org-2'), name: 'Other' });
    await repository.create(a);
    await repository.create(b);
    await repository.create(other);

    const all = await repository.list({ organizationId: oid('org-1'), limit: 20, offset: 0 });
    expect(all.total).toBe(2);

    const byType = await repository.list({ organizationId: oid('org-1'), type: ['WHITELIST'], limit: 20, offset: 0 });
    expect(byType.items.map((w) => w.name)).toEqual(['B']);

    const paged = await repository.list({ organizationId: oid('org-1'), limit: 1, offset: 1 });
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(1);
  });
});
