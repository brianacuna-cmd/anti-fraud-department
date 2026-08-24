import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationScreeningConfigRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoOrganizationScreeningConfigRepository.js';
import { OrganizationScreeningConfig } from '../../../src/modules/screening/domain/model/aggregates/OrganizationScreeningConfig.js';
import { createOrganizationScreeningConfigId } from '../../../src/modules/screening/domain/model/value-objects/OrganizationScreeningConfigId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { extractDuplicateKeyIndexName } from '../../../src/shared/persistence/mongo/duplicateKey.js';
import type { OrganizationScreeningConfigDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/OrganizationScreeningConfigDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildConfig(id: string, organizationId = oid('org-1')): OrganizationScreeningConfig {
  return OrganizationScreeningConfig.create({
    id: createOrganizationScreeningConfigId(oid(id)),
    organizationId,
    alertThreshold: 40,
    signalThreshold: 80,
    now: NOW,
  });
}

describe('MongoOrganizationScreeningConfigRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoOrganizationScreeningConfigRepository;

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
    repository = new MongoOrganizationScreeningConfigRepository(db);
  });

  afterEach(async () => {
    await db.collection('organization_screening_config').deleteMany({});
  });

  it('upserts a config and retrieves it by organization', async () => {
    await repository.upsert(buildConfig('config-1'));

    const found = await repository.findByOrganization(oid('org-1'));

    expect(found?.organizationId).toBe(oid('org-1'));
    expect(found?.alertThreshold).toBe(40);
    expect(found?.signalThreshold).toBe(80);
  });

  it('returns null when no config matches the given organization', async () => {
    const found = await repository.findByOrganization(oid('missing-org'));

    expect(found).toBeNull();
  });

  it('upsert is idempotent: a second call for the same org updates the existing singleton, not a duplicate', async () => {
    await repository.upsert(buildConfig('config-1'));
    await repository.upsert(
      OrganizationScreeningConfig.create({
        id: createOrganizationScreeningConfigId(oid('config-1')),
        organizationId: oid('org-1'),
        alertThreshold: 30,
        signalThreshold: 90,
        now: NOW,
      }),
    );

    const documents = await db
      .collection<OrganizationScreeningConfigDocument>('organization_screening_config')
      .find({ organization_id: new ObjectId(oid('org-1')) })
      .toArray();

    expect(documents).toHaveLength(1);
    expect(documents[0]?.alert_threshold).toBe(30);
  });

  it('rejects a raw duplicate OrganizationId insert via the org_screening_config_unique index', async () => {
    await repository.upsert(buildConfig('config-1'));

    let caughtError: unknown;
    try {
      await db.collection<OrganizationScreeningConfigDocument>('organization_screening_config').insertOne({
        _id: new ObjectId(oid('config-2')),
        organization_id: new ObjectId(oid('org-1')),
        alert_threshold: 40,
        signal_threshold: 80,
        created_at: new Date(NOW),
        updated_at: new Date(NOW),
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(extractDuplicateKeyIndexName(caughtError)).toBe('org_screening_config_unique');
  });
});
