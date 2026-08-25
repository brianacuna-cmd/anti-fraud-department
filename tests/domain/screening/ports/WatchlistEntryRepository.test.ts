import { oid } from '../../../support/oid.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildEntry(overrides: { organizationId?: string; watchlistId?: ReturnType<typeof generateWatchlistId>; status?: 'ACTIVE' | 'INACTIVE' | 'REMOVED' } = {}): WatchlistEntry {
  const entry = WatchlistEntry.create({
    id: generateWatchlistEntryId(),
    watchlistId: overrides.watchlistId ?? generateWatchlistId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    entryType: 'PERSON',
    name: 'John Smith',
    riskLevel: 'HIGH',
    now: NOW,
  });
  if (overrides.status && overrides.status !== 'ACTIVE') {
    return entry.softDelete(NOW);
  }
  return entry;
}

describe('WatchlistEntryRepository (port contract — InMemory)', () => {
  it('create and findById round-trip returns the stored entry', async () => {
    const repository = new InMemoryWatchlistEntryRepository();
    const entry = buildEntry();

    await repository.create(entry);
    const found = await repository.findById(entry.id);

    expect(found?.id).toBe(entry.id);
    expect(found?.name).toBe('John Smith');
    expect(found?.status).toBe('ACTIVE');
  });

  it('findById returns null when no entry exists for the given id', async () => {
    const repository = new InMemoryWatchlistEntryRepository();
    const found = await repository.findById(generateWatchlistEntryId());
    expect(found).toBeNull();
  });

  it('save persists an update to an existing entry', async () => {
    const repository = new InMemoryWatchlistEntryRepository();
    const entry = buildEntry();
    await repository.create(entry);

    const updated = entry.update({ riskLevel: 'CRITICAL' }, LATER);
    await repository.save(updated);

    const found = await repository.findById(entry.id);
    expect(found?.riskLevel).toBe('CRITICAL');
    expect(found?.updatedAt).toBe(LATER);
  });

  it('list scopes by watchlistId, filters by status, and paginates with total', async () => {
    const repository = new InMemoryWatchlistEntryRepository();
    const watchlistId = generateWatchlistId();
    const a = buildEntry({ watchlistId });
    const b = buildEntry({ watchlistId });
    const other = buildEntry({ watchlistId: generateWatchlistId() });
    await repository.create(a);
    await repository.create(b);
    await repository.create(other);

    const all = await repository.list({ watchlistId, organizationId: oid('org-1'), limit: 20, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(2);

    const byStatus = await repository.list({
      watchlistId,
      organizationId: oid('org-1'),
      status: ['ACTIVE'],
      limit: 20,
      offset: 0,
    });
    expect(byStatus.total).toBe(2);

    const paged = await repository.list({ watchlistId, organizationId: oid('org-1'), limit: 1, offset: 1 });
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(1);
  });
});
