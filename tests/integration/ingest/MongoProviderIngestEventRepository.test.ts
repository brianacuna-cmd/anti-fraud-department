import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoProviderIngestEventRepository } from '../../../src/modules/ingest/infrastructure/adapters/outbound/mongo/MongoProviderIngestEventRepository.js';
import { ProviderIngestEvent } from '../../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import { generateProviderIngestEventId } from '../../../src/modules/ingest/domain/model/value-objects/ProviderIngestEventId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildRow(providerEventId: string): ProviderIngestEvent {
  return ProviderIngestEvent.create({
    id: generateProviderIngestEventId(),
    organizationId: oid('org-1'),
    provider: 'stripe',
    providerEventId,
    status: 'RECEIVED',
    now: NOW,
  });
}

describe('MongoProviderIngestEventRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoProviderIngestEventRepository;

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
    repository = new MongoProviderIngestEventRepository(db);
  });

  afterEach(async () => {
    await db.collection('provider_ingest_events').deleteMany({});
  });

  it('findById returns the row inserted under its own _id', async () => {
    const row = buildRow('evt_by_id');
    await repository.insertUnique(row);

    const found = await repository.findById(row.id);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(row.id);
    expect(found?.providerEventId).toBe('evt_by_id');
    expect(found?.status).toBe('RECEIVED');
  });

  it('findById returns null when no row exists for that id', async () => {
    const found = await repository.findById(generateProviderIngestEventId());

    expect(found).toBeNull();
  });
});
