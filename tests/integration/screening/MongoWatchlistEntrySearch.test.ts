import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { normalizeName } from '../../../src/modules/screening/domain/ports/NameNormalizer.js';
import { MongoWatchlistEntryRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoWatchlistEntryRepository.js';
import { createWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import type { WatchlistEntryDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';

jest.setTimeout(60_000);

const ORG = oid('org-1');
const WATCHLIST = createWatchlistId(oid('watchlist-ofac'));
const CREATED = new Date('2026-09-11T04:00:00.000Z');

function doc(name: string, overrides: Partial<WatchlistEntryDocument> = {}): WatchlistEntryDocument {
  return {
    _id: new ObjectId(),
    watchlist_id: new ObjectId(WATCHLIST),
    organization_id: new ObjectId(ORG),
    entry_type: 'PERSON',
    name,
    normalized_name: normalizeName(name),
    phonetic_keys: [],
    document: null,
    wallet_address: null,
    risk_level: 'CRITICAL',
    country: null,
    status: 'ACTIVE',
    deleted_at: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

describe('MongoWatchlistEntryRepository.list — search', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoWatchlistEntryRepository;

  const search = async (term: string, extra: { status?: ('ACTIVE' | 'REMOVED')[] } = {}) =>
    (await repository.list({ watchlistId: WATCHLIST, organizationId: ORG, search: term, limit: 20, offset: 0, ...extra })).items
      .map((entry) => entry.name)
      .sort();

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    repository = new MongoWatchlistEntryRepository(db);
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertMany([
      doc('Juan Carlos PÉREZ GÓMEZ', { document: 'AB123456' }),
      doc('Perez Trading LLC', { entry_type: 'ORGANIZATION' }),
      doc('BANK MARKAZI JOMHOURI ISLAMI IRAN', { entry_type: 'WALLET', wallet_address: 'TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81' }),
      doc('Juan PEREZ (delisted)', { status: 'REMOVED' }),
      doc('Other org PEREZ', { organization_id: new ObjectId(oid('org-2')) }),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  it('finds names regardless of case and accents', async () => {
    expect(await search('pérez', { status: ['ACTIVE'] })).toEqual(['Juan Carlos PÉREZ GÓMEZ', 'Perez Trading LLC']);
    expect(await search('GOMEZ')).toEqual(['Juan Carlos PÉREZ GÓMEZ']);
  });

  it('finds a party by part of its document or wallet, whatever the case', async () => {
    expect(await search('ab1234')).toEqual(['Juan Carlos PÉREZ GÓMEZ']);
    expect(await search('tniq9axbp9')).toEqual(['BANK MARKAZI JOMHOURI ISLAMI IRAN']);
  });

  it('combines with the other filters and stays inside the organization', async () => {
    expect(await search('perez', { status: ['REMOVED'] })).toEqual(['Juan PEREZ (delisted)']);
  });

  it('treats regex characters literally instead of as a pattern', async () => {
    await expect(search('.*')).resolves.toEqual([]);
    await expect(search('a(b')).resolves.toEqual([]);
  });
});
