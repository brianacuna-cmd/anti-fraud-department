import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { MongoSyncedWatchlistEntryStore } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoSyncedWatchlistEntryStore.js';
import { MongoFallbackWatchlistCandidateRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoFallbackWatchlistCandidateRepository.js';
import { generateWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import type {
  SanctionListRecord,
  SyncedEntryWrite,
  WatchlistSyncChange,
} from '../../../src/modules/screening/domain/ports/SyncedWatchlistEntryStore.js';
import type { WatchlistEntryDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';

jest.setTimeout(60_000);

const ORG = oid('org-1');
const WATCHLIST = createWatchlistId(oid('watchlist-ofac'));
const OTHER_WATCHLIST = createWatchlistId(oid('watchlist-eu'));
const T1 = fromDate(new Date('2026-09-11T04:00:00.000Z'));
const T2 = fromDate(new Date('2026-09-12T04:00:00.000Z'));

const record = (ref: string, overrides: Partial<SanctionListRecord> = {}): SanctionListRecord => ({
  externalRef: ref,
  entryType: 'PERSON',
  name: 'Juan Carlos Perez Gomez',
  document: null,
  walletAddress: null,
  country: 'Colombia',
  ...overrides,
});

const write = (id: WatchlistEntryId, rec: SanctionListRecord, fingerprint = 'fp-1'): SyncedEntryWrite => ({
  id,
  record: rec,
  fingerprint,
  indexed: { normalizedName: 'juan carlos perez gomez', phoneticKeys: ['JN', 'KRLS', 'PRS', 'KMS'] },
});

const change = (overrides: Partial<WatchlistSyncChange>): WatchlistSyncChange => ({
  watchlistId: WATCHLIST,
  organizationId: ORG,
  riskLevel: 'CRITICAL',
  inserts: [],
  updates: [],
  removals: [],
  now: T1,
  ...overrides,
});

describe('MongoSyncedWatchlistEntryStore (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let store: MongoSyncedWatchlistEntryStore;

  const document = (id: WatchlistEntryId) =>
    db.collection<WatchlistEntryDocument>('watchlist_entries').findOne({ _id: new ObjectId(id) });

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    store = new MongoSyncedWatchlistEntryStore(db);
  });

  afterEach(async () => {
    await db.collection('watchlist_entries').deleteMany({});
  });

  it('inserts entries that the candidate query finds straight away', async () => {
    const id = generateWatchlistEntryId();
    await store.apply(change({ inserts: [write(id, record('7001|name|juan carlos perez gomez'))] }));

    expect(await document(id)).toEqual(
      expect.objectContaining({
        organization_id: new ObjectId(ORG),
        watchlist_id: new ObjectId(WATCHLIST),
        external_ref: '7001|name|juan carlos perez gomez',
        sync_fingerprint: 'fp-1',
        risk_level: 'CRITICAL',
        status: 'ACTIVE',
        deleted_at: null,
        normalized_name: 'juan carlos perez gomez',
        created_at: new Date(T1),
        updated_at: new Date(T1),
      }),
    );
    const candidates = await new MongoFallbackWatchlistCandidateRepository(db).findCandidates({
      organizationId: ORG,
      entryType: 'PERSON',
      phoneticKeys: ['PRS'],
      limit: 10,
    });
    expect(candidates.map((candidate) => String(candidate.id))).toEqual([String(id)]);
  });

  it('lists snapshots of this watchlist only, and never of hand-made entries', async () => {
    const synced = generateWatchlistEntryId();
    await store.apply(change({ inserts: [write(synced, record('a'))] }));
    await store.apply(change({ watchlistId: OTHER_WATCHLIST, inserts: [write(generateWatchlistEntryId(), record('b'))] }));
    await db.collection('watchlist_entries').insertOne({
      _id: new ObjectId(),
      watchlist_id: new ObjectId(WATCHLIST),
      organization_id: new ObjectId(ORG),
      name: 'Added by hand',
      status: 'ACTIVE',
    });

    expect(await store.listSnapshots(WATCHLIST)).toEqual([
      { id: synced, externalRef: 'a', fingerprint: 'fp-1', active: true },
    ]);
  });

  it('updates in place, reactivating a removed entry and keeping its creation date', async () => {
    const id = generateWatchlistEntryId();
    await store.apply(change({ inserts: [write(id, record('a'))] }));
    await store.apply(change({ removals: [id], now: T1 }));
    expect((await store.listSnapshots(WATCHLIST))[0]!.active).toBe(false);

    await store.apply(change({ updates: [write(id, record('a', { country: 'Cuba' }), 'fp-2')], now: T2 }));

    expect(await document(id)).toEqual(
      expect.objectContaining({
        country: 'Cuba',
        sync_fingerprint: 'fp-2',
        status: 'ACTIVE',
        deleted_at: null,
        created_at: new Date(T1),
        updated_at: new Date(T2),
      }),
    );
  });

  it('removes with the same soft delete the rest of screening uses', async () => {
    const id = generateWatchlistEntryId();
    await store.apply(change({ inserts: [write(id, record('a'))] }));

    await store.apply(change({ removals: [id], now: T2 }));

    expect(await document(id)).toEqual(expect.objectContaining({ status: 'REMOVED', deleted_at: new Date(T2) }));
  });

  it('rejects a second entry with the same reference in the same watchlist', async () => {
    await store.apply(change({ inserts: [write(generateWatchlistEntryId(), record('a'))] }));

    await expect(store.apply(change({ inserts: [write(generateWatchlistEntryId(), record('a'))] }))).rejects.toThrow(
      /duplicate key/,
    );
  });

  it('writes a list larger than one bulk batch', async () => {
    const inserts = Array.from({ length: 2500 }, (_, i) => write(generateWatchlistEntryId(), record(`ref-${i}`)));

    await store.apply(change({ inserts }));

    expect(await store.listSnapshots(WATCHLIST)).toHaveLength(2500);
  });

  it('stamps the last sync on the watchlist without touching its edit date', async () => {
    const _id = new ObjectId(WATCHLIST);
    await db.collection('watchlists').insertOne({ _id, name: 'OFAC SDN (official feed)', updated_at: new Date(T1) });

    await store.recordSync(WATCHLIST, T2);

    expect(await db.collection('watchlists').findOne({ _id })).toEqual(
      expect.objectContaining({ last_synced_at: new Date(T2), updated_at: new Date(T1) }),
    );
    await db.collection('watchlists').deleteMany({});
  });
});
