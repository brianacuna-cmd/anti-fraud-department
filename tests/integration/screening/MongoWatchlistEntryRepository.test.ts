import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoWatchlistEntryRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoWatchlistEntryRepository.js';
import { createWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistEntryDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';

jest.setTimeout(60_000);

function buildDocument(overrides: Partial<WatchlistEntryDocument> = {}): WatchlistEntryDocument {
  return {
    _id: new ObjectId(oid('entry-1')),
    watchlist_id: new ObjectId(oid('watchlist-1')),
    organization_id: new ObjectId(oid('org-1')),
    tipo_entrada: 'PERSON',
    nombre: 'John Smith',
    nombre_normalizado: '',
    phonetic_keys: [],
    documento: '123456789',
    wallet_address: null,
    nivel_riesgo: 'HIGH',
    pais: 'US',
    estado: 'ACTIVE',
    deleted_at: null,
    ...overrides,
  };
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

  it('findToIndex returns id + raw nombre for an existing entry', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(buildDocument());

    const result = await repository.findToIndex(createWatchlistEntryId(oid('entry-1')));

    expect(result?.nombre).toBe('John Smith');
    expect(result?.id).toBe(oid('entry-1'));
  });

  it('findToIndex returns null when the entry does not exist', async () => {
    const result = await repository.findToIndex(createWatchlistEntryId(oid('entry-missing')));
    expect(result).toBeNull();
  });

  it('updateIndexedFields persists nombre_normalizado and phonetic_keys onto the entry', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(buildDocument());

    await repository.updateIndexedFields(createWatchlistEntryId(oid('entry-1')), {
      nombreNormalizado: 'john smith',
      phoneticKeys: ['JN', 'SM0'],
    });

    const stored = await db
      .collection<WatchlistEntryDocument>('watchlist_entries')
      .findOne({ _id: new ObjectId(oid('entry-1')) });

    expect(stored?.nombre_normalizado).toBe('john smith');
    expect(stored?.phonetic_keys).toEqual(['JN', 'SM0']);
  });
});
