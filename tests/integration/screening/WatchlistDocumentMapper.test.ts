import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { Watchlist } from '../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { generateWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { toDocument, toDomain } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/mappers/WatchlistDocumentMapper.js';
import type { WatchlistDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistDocument.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildWatchlist(): Watchlist {
  return Watchlist.create({
    id: generateWatchlistId(),
    organizationId: oid('org-1'),
    name: 'Global Sanctions',
    source: 'OFAC',
    type: 'BLACKLIST',
    description: 'OFAC SDN list',
    now: NOW,
  });
}

describe('WatchlistDocument mapper (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

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

  afterEach(async () => {
    await db.collection('watchlists').deleteMany({});
  });

  it('round-trips through toDocument/toDomain preserving all fields', async () => {
    const watchlist = buildWatchlist();

    await db.collection<WatchlistDocument>('watchlists').insertOne(toDocument(watchlist));
    const found = await db.collection<WatchlistDocument>('watchlists').findOne({});

    expect(found).not.toBeNull();
    const rehydrated = toDomain(found!);

    expect(rehydrated.id).toBe(watchlist.id);
    expect(rehydrated.organizationId).toBe(watchlist.organizationId);
    expect(rehydrated.name).toBe('Global Sanctions');
    expect(rehydrated.source).toBe('OFAC');
    expect(rehydrated.type).toBe('BLACKLIST');
    expect(rehydrated.description).toBe('OFAC SDN list');
    expect(rehydrated.status).toBe('ACTIVE');
    expect(rehydrated.deletedAt).toBeNull();
    expect(rehydrated.createdAt).toBe(watchlist.createdAt);
    expect(rehydrated.updatedAt).toBe(watchlist.updatedAt);
  });

  it('stores document fields snake_case', async () => {
    const watchlist = buildWatchlist();

    await db.collection<WatchlistDocument>('watchlists').insertOne(toDocument(watchlist));
    const raw = await db.collection('watchlists').findOne({});

    expect(raw).toMatchObject({
      organization_id: expect.anything(),
      name: 'Global Sanctions',
      source: 'OFAC',
      type: 'BLACKLIST',
      description: 'OFAC SDN list',
      status: 'ACTIVE',
      deleted_at: null,
    });
  });

  it('round-trips null description and a non-null deletedAt (soft-deleted)', async () => {
    const watchlist = Watchlist.create({
      id: generateWatchlistId(),
      organizationId: oid('org-1'),
      name: 'Internal List',
      source: 'manual',
      type: 'WHITELIST',
      now: NOW,
    }).softDelete(fromDate(new Date('2026-01-02T00:00:00.000Z')));

    await db.collection<WatchlistDocument>('watchlists').insertOne(toDocument(watchlist));
    const found = await db.collection<WatchlistDocument>('watchlists').findOne({});
    const rehydrated = toDomain(found!);

    expect(rehydrated.description).toBeNull();
    expect(rehydrated.status).toBe('INACTIVE');
    expect(rehydrated.deletedAt).toBe(watchlist.deletedAt);
  });
});
