import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoWatchlistEntryRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoWatchlistEntryRepository.js';
import { createWatchlistEntryId, generateWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { generateWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { WatchlistEntry } from '../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { WatchlistEntryDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildDocument(overrides: Partial<WatchlistEntryDocument> = {}): WatchlistEntryDocument {
  return {
    _id: new ObjectId(oid('entry-1')),
    watchlist_id: new ObjectId(oid('watchlist-1')),
    organization_id: new ObjectId(oid('org-1')),
    entry_type: 'PERSON',
    name: 'John Smith',
    normalized_name: '',
    phonetic_keys: [],
    document: '123456789',
    wallet_address: null,
    risk_level: 'HIGH',
    country: 'US',
    status: 'ACTIVE',
    deleted_at: null,
    created_at: new Date(NOW),
    updated_at: new Date(NOW),
    ...overrides,
  };
}

function buildEntry(overrides: { watchlistId?: ReturnType<typeof generateWatchlistId>; name?: string } = {}): WatchlistEntry {
  return WatchlistEntry.create({
    id: generateWatchlistEntryId(),
    watchlistId: overrides.watchlistId ?? generateWatchlistId(),
    organizationId: oid('org-1'),
    entryType: 'PERSON',
    name: overrides.name ?? 'Jane Doe',
    riskLevel: 'MEDIUM',
    country: 'US',
    now: NOW,
  });
}

describe('MongoWatchlistEntryRepository (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoWatchlistEntryRepository;

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
    repository = new MongoWatchlistEntryRepository(db);
  });

  afterEach(async () => {
    await db.collection('watchlist_entries').deleteMany({});
  });

  it('findToIndex returns id + raw name for an existing entry', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(buildDocument());

    const result = await repository.findToIndex(createWatchlistEntryId(oid('entry-1')));

    expect(result?.name).toBe('John Smith');
    expect(result?.id).toBe(oid('entry-1'));
  });

  it('findToIndex returns null when the entry does not exist', async () => {
    const result = await repository.findToIndex(createWatchlistEntryId(oid('entry-missing')));
    expect(result).toBeNull();
  });

  it('updateIndexedFields persists normalized_name and phonetic_keys onto the entry', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(buildDocument());

    await repository.updateIndexedFields(createWatchlistEntryId(oid('entry-1')), {
      normalizedName: 'john smith',
      phoneticKeys: ['JN', 'SM0'],
    });

    const stored = await db
      .collection<WatchlistEntryDocument>('watchlist_entries')
      .findOne({ _id: new ObjectId(oid('entry-1')) });

    expect(stored?.normalized_name).toBe('john smith');
    expect(stored?.phonetic_keys).toEqual(['JN', 'SM0']);
  });

  it('create / findById round-trip returns the stored WatchlistEntry aggregate', async () => {
    const entry = buildEntry();

    await repository.create(entry);
    const found = await repository.findById(entry.id);

    expect(found?.id).toBe(entry.id);
    expect(found?.name).toBe('Jane Doe');
    expect(found?.status).toBe('ACTIVE');
    expect(found?.riskLevel).toBe('MEDIUM');
  });

  it('findById returns null when no entry exists for the given id', async () => {
    const found = await repository.findById(generateWatchlistEntryId());
    expect(found).toBeNull();
  });

  it('save persists an update to an existing entry', async () => {
    const entry = buildEntry();
    await repository.create(entry);

    const updated = entry.update({ riskLevel: 'CRITICAL' }, LATER);
    await repository.save(updated);

    const found = await repository.findById(entry.id);
    expect(found?.riskLevel).toBe('CRITICAL');
  });

  it('list scopes by watchlistId, paginates, and returns correct total', async () => {
    const watchlistId = generateWatchlistId();
    const a = buildEntry({ watchlistId });
    const b = buildEntry({ watchlistId, name: 'Alice Smith' });
    const other = buildEntry({ watchlistId: generateWatchlistId() });
    await repository.create(a);
    await repository.create(b);
    await repository.create(other);

    const all = await repository.list({ watchlistId, organizationId: oid('org-1'), limit: 20, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(2);

    const paged = await repository.list({ watchlistId, organizationId: oid('org-1'), limit: 1, offset: 1 });
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(1);
  });

  it('list filters by status', async () => {
    const watchlistId = generateWatchlistId();
    const active = buildEntry({ watchlistId });
    const removed = buildEntry({ watchlistId }).softDelete(NOW);
    await repository.create(active);
    await repository.create(removed);

    const activeOnly = await repository.list({
      watchlistId,
      organizationId: oid('org-1'),
      status: ['ACTIVE'],
      limit: 20,
      offset: 0,
    });
    expect(activeOnly.total).toBe(1);
    expect(activeOnly.items[0]?.status).toBe('ACTIVE');
  });
});
