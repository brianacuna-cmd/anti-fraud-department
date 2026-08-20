import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoProviderIngestEventRepository } from '../../../src/modules/ingest/infrastructure/adapters/outbound/mongo/MongoProviderIngestEventRepository.js';
import { MongoInboundWebhookSecretRepository } from '../../../src/modules/ingest/infrastructure/adapters/outbound/mongo/MongoInboundWebhookSecretRepository.js';
import { ProviderIngestEvent } from '../../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import { InboundWebhookSecret } from '../../../src/modules/ingest/domain/model/aggregates/InboundWebhookSecret.js';
import { generateProviderIngestEventId } from '../../../src/modules/ingest/domain/model/value-objects/ProviderIngestEventId.js';
import { generateInboundWebhookSecretId } from '../../../src/modules/ingest/domain/model/value-objects/InboundWebhookSecretId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import {
  extractDuplicateKeyIndexName,
  PROVIDER_INGEST_EVENT_UNIQUE_INDEX,
} from '../../../src/modules/ingest/infrastructure/adapters/outbound/mongo/duplicateKey.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');

describe('Mongo ingest repositories (integration)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

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

  afterEach(async () => {
    await db.collection('provider_ingest_events').deleteMany({});
    await db.collection('organization_inbound_webhook_secrets').deleteMany({});
  });

  it('insertUnique persists a first delivery and returns duplicate on E11000 unique index', async () => {
    const events = new MongoProviderIngestEventRepository(db);
    const first = ProviderIngestEvent.create({
      id: generateProviderIngestEventId(),
      organizationId: ORG,
      provider: 'stripe',
      providerEventId: 'evt_dup',
      status: 'RECEIVED',
      now: NOW,
    });
    const second = ProviderIngestEvent.create({
      id: generateProviderIngestEventId(),
      organizationId: ORG,
      provider: 'stripe',
      providerEventId: 'evt_dup',
      status: 'RECEIVED',
      now: NOW,
    });

    expect(await events.insertUnique(first)).toBe('inserted');
    expect(await events.insertUnique(second)).toBe('duplicate');
    const found = await events.findByOrgProviderEvent(ORG, 'stripe', 'evt_dup');
    expect(found?.id).toBe(first.id);
    expect(found?.status).toBe('RECEIVED');
  });

  it('findByOrgProvider loads the secret for (organization, provider)', async () => {
    const secrets = new MongoInboundWebhookSecretRepository(db);
    const row = InboundWebhookSecret.create({
      id: generateInboundWebhookSecretId(),
      organizationId: ORG,
      provider: 'coinflow',
      ciphertext: 'cipher:validation-key',
      now: NOW,
    });

    await secrets.save(row);

    const found = await secrets.findByOrgProvider(ORG, 'coinflow');
    expect(found?.ciphertext).toBe('cipher:validation-key');
    expect(found?.provider).toBe('coinflow');
    await expect(secrets.findByOrgProvider(ORG, 'stripe')).resolves.toBeNull();
  });

  it('extracts the ingest unique index name from an E11000-shaped error', () => {
    expect(
      extractDuplicateKeyIndexName({
        code: 11000,
        errmsg: `E11000 duplicate key error collection: test.provider_ingest_events index: ${PROVIDER_INGEST_EVENT_UNIQUE_INDEX} dup key`,
      }),
    ).toBe(PROVIDER_INGEST_EVENT_UNIQUE_INDEX);
    expect(extractDuplicateKeyIndexName({ code: 1, message: 'other' })).toBeUndefined();
  });
});
