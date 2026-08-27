import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoWatchlistEntryRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoWatchlistEntryRepository.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { WatchlistEntryDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';
import { createWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';

jest.setTimeout(60_000);

const ORG_ID = oid('org-1');
const WATCHLIST_ID_A = oid('watchlist-a');
const WATCHLIST_ID_B = oid('watchlist-b');
const WATCHLIST_ID_C = oid('watchlist-c');

const T0 = fromDate(new Date('2026-01-01T00:00:00.000Z')); // watermark
const T1 = fromDate(new Date('2026-01-02T00:00:00.000Z')); // after watermark
const T2 = fromDate(new Date('2026-01-03T00:00:00.000Z')); // after T1
const T3 = fromDate(new Date('2026-01-04T00:00:00.000Z')); // after T2

function walletDoc(overrides: Partial<WatchlistEntryDocument> & { _id: ObjectId; watchlist_id: ObjectId; updated_at: Date }): WatchlistEntryDocument {
  return {
    organization_id: new ObjectId(ORG_ID),
    entry_type: 'WALLET',
    name: overrides.wallet_address ?? 'addr',
    normalized_name: '',
    phonetic_keys: [],
    document: null,
    risk_level: 'HIGH',
    country: null,
    status: 'ACTIVE',
    deleted_at: null,
    created_at: new Date(T0),
    wallet_address: '0xabc',
    ...overrides,
  };
}

describe('MongoWatchlistEntryRepository — listActiveWalletEntriesUpdatedSince (integration)', () => {
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

  // Task 2.4 RED — delta after watermark: only entries updated strictly after T0 are returned
  it('returns only ACTIVE WALLET entries updated strictly after updatedSince', async () => {
    const staleDoc = walletDoc({
      _id: new ObjectId(oid('entry-stale')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      wallet_address: '0xstale',
      updated_at: new Date(T0), // AT watermark, not after → excluded
    });
    const freshDoc = walletDoc({
      _id: new ObjectId(oid('entry-fresh')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      wallet_address: '0xfresh',
      updated_at: new Date(T1), // after watermark → included
    });
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertMany([staleDoc, freshDoc]);

    const results = await repository.listActiveWalletEntriesUpdatedSince({
      organizationId: ORG_ID,
      watchlistIds: [createWatchlistId(WATCHLIST_ID_A)],
      updatedSince: T0,
      limit: 20,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.walletAddress).toBe('0xfresh');
  });

  // Triangulate: REMOVED entries excluded
  it('excludes REMOVED entries even when updated_at is after the watermark', async () => {
    const activeDoc = walletDoc({
      _id: new ObjectId(oid('entry-active')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      wallet_address: '0xactive',
      updated_at: new Date(T1),
    });
    const removedDoc = walletDoc({
      _id: new ObjectId(oid('entry-removed')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      wallet_address: '0xremoved',
      status: 'REMOVED',
      deleted_at: new Date(T1),
      updated_at: new Date(T1),
    });
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertMany([activeDoc, removedDoc]);

    const results = await repository.listActiveWalletEntriesUpdatedSince({
      organizationId: ORG_ID,
      watchlistIds: [createWatchlistId(WATCHLIST_ID_A)],
      updatedSince: T0,
      limit: 20,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.walletAddress).toBe('0xactive');
  });

  // Triangulate: watchlistIds scoping — only entries from requested watchlists included
  it('scopes results to the requested watchlistIds only', async () => {
    const inScopeDoc = walletDoc({
      _id: new ObjectId(oid('entry-in-scope')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      wallet_address: '0xin',
      updated_at: new Date(T1),
    });
    const outOfScopeDoc = walletDoc({
      _id: new ObjectId(oid('entry-out-scope')),
      watchlist_id: new ObjectId(WATCHLIST_ID_C),
      wallet_address: '0xout',
      updated_at: new Date(T1),
    });
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertMany([inScopeDoc, outOfScopeDoc]);

    const results = await repository.listActiveWalletEntriesUpdatedSince({
      organizationId: ORG_ID,
      watchlistIds: [createWatchlistId(WATCHLIST_ID_A)],
      updatedSince: T0,
      limit: 20,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.walletAddress).toBe('0xin');
  });

  // Task 2.4 RED — keyset: no-skip on equal updated_at, cursor on (updatedAt, id) ASC
  it('keyset cursor does not skip entries with equal updated_at when paginating', async () => {
    // Three entries all updated at T1; IDs determine ASC order within tie
    const idA = oid('entry-id-aaa');
    const idB = oid('entry-id-bbb');
    const idC = oid('entry-id-ccc');
    const docs = [idA, idB, idC].map((id, i) =>
      walletDoc({
        _id: new ObjectId(id),
        watchlist_id: new ObjectId(WATCHLIST_ID_B),
        wallet_address: `0x${i}`,
        updated_at: new Date(T1),
      }),
    );
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertMany(docs);

    // First page: limit 2
    const page1 = await repository.listActiveWalletEntriesUpdatedSince({
      organizationId: ORG_ID,
      watchlistIds: [createWatchlistId(WATCHLIST_ID_B)],
      updatedSince: T0,
      limit: 2,
    });
    expect(page1).toHaveLength(2);

    // Second page: cursor starts after last entry of page1
    const lastOfPage1 = page1[page1.length - 1]!;
    const page2 = await repository.listActiveWalletEntriesUpdatedSince({
      organizationId: ORG_ID,
      watchlistIds: [createWatchlistId(WATCHLIST_ID_B)],
      updatedSince: T0,
      limit: 2,
      after: { updatedAt: lastOfPage1.updatedAt, id: lastOfPage1.id },
    });
    expect(page2).toHaveLength(1);

    // No overlap between pages
    const allIds = [...page1.map((e) => e.id), ...page2.map((e) => e.id)];
    expect(new Set(allIds).size).toBe(3);
  });

  // Triangulate: updatedSince=null returns all entries (backfill from epoch)
  it('returns all ACTIVE WALLET entries when updatedSince is null (backfill)', async () => {
    const doc1 = walletDoc({
      _id: new ObjectId(oid('entry-backfill-1')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      wallet_address: '0xold',
      updated_at: new Date('2020-01-01T00:00:00.000Z'),
    });
    const doc2 = walletDoc({
      _id: new ObjectId(oid('entry-backfill-2')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      wallet_address: '0xnew',
      updated_at: new Date(T3),
    });
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertMany([doc1, doc2]);

    const results = await repository.listActiveWalletEntriesUpdatedSince({
      organizationId: ORG_ID,
      watchlistIds: [createWatchlistId(WATCHLIST_ID_A)],
      updatedSince: null,
      limit: 20,
    });

    expect(results).toHaveLength(2);
  });

  // Triangulate: non-WALLET entry_type excluded
  it('excludes non-WALLET entry types (PERSON, etc.)', async () => {
    const personDoc: WatchlistEntryDocument = {
      _id: new ObjectId(oid('entry-person')),
      watchlist_id: new ObjectId(WATCHLIST_ID_A),
      organization_id: new ObjectId(ORG_ID),
      entry_type: 'PERSON',
      name: 'John Doe',
      normalized_name: '',
      phonetic_keys: [],
      document: '123',
      wallet_address: null,
      risk_level: 'HIGH',
      country: null,
      status: 'ACTIVE',
      deleted_at: null,
      created_at: new Date(T0),
      updated_at: new Date(T2),
    };
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(personDoc);

    const results = await repository.listActiveWalletEntriesUpdatedSince({
      organizationId: ORG_ID,
      watchlistIds: [createWatchlistId(WATCHLIST_ID_A)],
      updatedSince: T0,
      limit: 20,
    });

    expect(results).toHaveLength(0);
  });
});
