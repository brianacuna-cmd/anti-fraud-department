import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoFallbackWatchlistCandidateRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoFallbackWatchlistCandidateRepository.js';
import type { WatchlistEntryDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';

jest.setTimeout(60_000);

function buildEntry(overrides: Partial<WatchlistEntryDocument> = {}): WatchlistEntryDocument {
  return {
    _id: new ObjectId(oid(`entry-${Math.random()}`)),
    watchlist_id: new ObjectId(oid('watchlist-1')),
    organization_id: new ObjectId(oid('org-1')),
    tipo_entrada: 'PERSON',
    nombre: 'John Smith',
    nombre_normalizado: 'john smith',
    phonetic_keys: ['JN', 'SM0'],
    documento: '123456789',
    wallet_address: null,
    nivel_riesgo: 'HIGH',
    pais: 'US',
    estado: 'ACTIVE',
    deleted_at: null,
    ...overrides,
  };
}

describe('MongoFallbackWatchlistCandidateRepository (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoFallbackWatchlistCandidateRepository;

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
    repository = new MongoFallbackWatchlistCandidateRepository(db);
  });

  afterEach(async () => {
    await db.collection('watchlist_entries').deleteMany({});
  });

  it('returns a bounded candidate set via phonetic-key blocking', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(buildEntry());

    const candidates = await repository.findCandidates({
      organizationId: oid('org-1'),
      normalizedName: 'john smith',
      phoneticKeys: ['JN'],
      entryType: 'PERSON',
      limit: 15,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.nombre).toBe('John Smith');
  });

  it('enforces org-tenant isolation: org A entry never returned for org B screening', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(
      buildEntry({ organization_id: new ObjectId(oid('org-A')) }),
    );

    const candidates = await repository.findCandidates({
      organizationId: oid('org-B'),
      normalizedName: 'john smith',
      phoneticKeys: ['JN'],
      entryType: 'PERSON',
      limit: 15,
    });

    expect(candidates).toHaveLength(0);
  });

  it('excludes estado=REMOVED entries', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(
      buildEntry({ estado: 'REMOVED' }),
    );

    const candidates = await repository.findCandidates({
      organizationId: oid('org-1'),
      normalizedName: 'john smith',
      phoneticKeys: ['JN'],
      entryType: 'PERSON',
      limit: 15,
    });

    expect(candidates).toHaveLength(0);
  });

  it('excludes soft-deleted entries (deleted_at set)', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(
      buildEntry({ deleted_at: new Date() }),
    );

    const candidates = await repository.findCandidates({
      organizationId: oid('org-1'),
      normalizedName: 'john smith',
      phoneticKeys: ['JN'],
      entryType: 'PERSON',
      limit: 15,
    });

    expect(candidates).toHaveLength(0);
  });

  it('completes without error and returns an empty set when nothing matches', async () => {
    const candidates = await repository.findCandidates({
      organizationId: oid('org-1'),
      normalizedName: 'nonexistent name',
      phoneticKeys: ['ZZ'],
      entryType: 'PERSON',
      limit: 15,
    });

    expect(candidates).toEqual([]);
  });

  it('returns empty when no blocking fields are provided instead of dumping all active entries', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(
      buildEntry({ nombre: 'Some Active Entry' }),
    );

    const candidates = await repository.findCandidates({
      organizationId: oid('org-1'),
      entryType: 'PERSON',
      limit: 15,
    });

    expect(candidates).toEqual([]);
  });

  it('matches by exact documento even when phonetic keys diverge', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(
      buildEntry({ nombre: 'Different Name', nombre_normalizado: 'different name', phonetic_keys: ['XX'] }),
    );

    const candidates = await repository.findCandidates({
      organizationId: oid('org-1'),
      documento: '123456789',
      entryType: 'PERSON',
      limit: 15,
    });

    expect(candidates).toHaveLength(1);
  });
});
