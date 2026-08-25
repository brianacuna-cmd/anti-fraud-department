import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoWatchlistRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoWatchlistRepository.js';
import { Watchlist } from '../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { generateWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildWatchlist(overrides: { organizationId?: string; name?: string; type?: 'BLACKLIST' | 'WHITELIST'; now?: ReturnType<typeof fromDate> } = {}): Watchlist {
  return Watchlist.create({
    id: generateWatchlistId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    name: overrides.name ?? 'Global Sanctions',
    source: 'OFAC',
    type: overrides.type ?? 'BLACKLIST',
    description: 'OFAC SDN list',
    now: overrides.now ?? NOW,
  });
}

describe('MongoWatchlistRepository (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoWatchlistRepository;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    repository = new MongoWatchlistRepository(db);
  });

  afterEach(async () => {
    await db.collection('watchlists').deleteMany({});
  });

  it('create / findById round-trip', async () => {
    const watchlist = buildWatchlist();

    await repository.create(watchlist);
    const found = await repository.findById(watchlist.id);

    expect(found?.id).toBe(watchlist.id);
    expect(found?.name).toBe('Global Sanctions');
  });

  it('returns null when no watchlist exists for the given id', async () => {
    const found = await repository.findById(generateWatchlistId());
    expect(found).toBeNull();
  });

  it('save persists an update to an existing watchlist', async () => {
    const watchlist = buildWatchlist();
    await repository.create(watchlist);

    const renamed = watchlist.update({ name: 'Renamed List' }, fromDate(new Date('2026-01-02T00:00:00.000Z')));
    await repository.save(renamed);

    const found = await repository.findById(watchlist.id);
    expect(found?.name).toBe('Renamed List');
  });

  it('findByNameForOrg returns the match, scoped to org, excluding soft-deleted', async () => {
    const watchlist = buildWatchlist({ organizationId: oid('org-1'), name: 'Global Sanctions' });
    await repository.create(watchlist);

    const found = await repository.findByNameForOrg(oid('org-1'), 'Global Sanctions');
    expect(found?.id).toBe(watchlist.id);

    const otherOrg = await repository.findByNameForOrg(oid('org-2'), 'Global Sanctions');
    expect(otherOrg).toBeNull();

    const notFound = await repository.findByNameForOrg(oid('org-1'), 'Nonexistent');
    expect(notFound).toBeNull();
  });

  it('findByNameForOrg returns null once the matching watchlist is soft-deleted', async () => {
    const watchlist = buildWatchlist({ organizationId: oid('org-1'), name: 'Global Sanctions' });
    await repository.create(watchlist);
    await repository.save(watchlist.softDelete(fromDate(new Date('2026-01-02T00:00:00.000Z'))));

    const found = await repository.findByNameForOrg(oid('org-1'), 'Global Sanctions');
    expect(found).toBeNull();
  });

  it('lists tenant watchlists, filters by type/status, and paginates with total', async () => {
    const blacklist = buildWatchlist({ organizationId: oid('org-1'), name: 'Blacklist A', type: 'BLACKLIST', now: fromDate(new Date('2026-01-01T00:00:00.000Z')) });
    const whitelist = buildWatchlist({ organizationId: oid('org-1'), name: 'Whitelist B', type: 'WHITELIST', now: fromDate(new Date('2026-01-02T00:00:00.000Z')) });
    const otherOrg = buildWatchlist({ organizationId: oid('org-2'), name: 'Other Org List', now: fromDate(new Date('2026-01-03T00:00:00.000Z')) });
    await repository.create(blacklist);
    await repository.create(whitelist);
    await repository.create(otherOrg);

    const all = await repository.list({ organizationId: oid('org-1'), limit: 20, offset: 0 });
    expect(all.total).toBe(2);

    const byType = await repository.list({ organizationId: oid('org-1'), type: ['WHITELIST'], limit: 20, offset: 0 });
    expect(byType.total).toBe(1);
    expect(byType.items[0]?.name).toBe('Whitelist B');

    const paged = await repository.list({ organizationId: oid('org-1'), limit: 1, offset: 1 });
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(1);

    await repository.save(blacklist.softDelete(fromDate(new Date('2026-01-04T00:00:00.000Z'))));
    const byStatus = await repository.list({ organizationId: oid('org-1'), status: ['INACTIVE'], limit: 20, offset: 0 });
    expect(byStatus.total).toBe(1);
    expect(byStatus.items[0]?.name).toBe('Blacklist A');
  });
});
