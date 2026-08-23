import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationFraudConfigRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoOrganizationFraudConfigRepository.js';
import { OrganizationFraudConfig } from '../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { fromDate, toDate } from '../../../src/shared/time/Instant.js';
import { extractDuplicateKeyIndexName } from '../../../src/shared/persistence/mongo/duplicateKey.js';
import type { OrganizationFraudConfigDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/OrganizationFraudConfigDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildConfig(id: string, organizationId = oid('org-1')): OrganizationFraudConfig {
  return OrganizationFraudConfig.create({
    id: createOrganizationFraudConfigId(oid(id)),
    organizationId,
    slaLowMinutes: 240,
    slaMediumMinutes: 120,
    slaHighMinutes: 60,
    slaCriticalMinutes: 30,
    riskThresholdLow: 25,
    riskThresholdMedium: 50,
    riskThresholdHigh: 75,
    riskThresholdCritical: 90,
    featureFlags: {},
    now: NOW,
  });
}

describe('MongoOrganizationFraudConfigRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoOrganizationFraudConfigRepository;

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
    repository = new MongoOrganizationFraudConfigRepository(db);
  });

  afterEach(async () => {
    await db.collection('organization_fraud_config').deleteMany({});
  });

  it('upserts a config and retrieves it by organization', async () => {
    await repository.upsert(buildConfig('config-1'));

    const found = await repository.findByOrganization(oid('org-1'));

    expect(found?.organizationId).toBe(oid('org-1'));
    expect(found?.slaHighMinutes).toBe(60);
    expect(found?.riskThresholdCritical).toBe(90);
    expect(found?.outboundWebhookUrl).toBeNull();
  });

  it('persists and reads outboundWebhookUrl', async () => {
    await repository.upsert(
      buildConfig('config-1').update({ outboundWebhookUrl: 'https://hooks.example/fraud' }, NOW),
    );

    const found = await repository.findByOrganization(oid('org-1'));

    expect(found?.outboundWebhookUrl).toBe('https://hooks.example/fraud');
  });

  it('returns null when no config matches the given organization', async () => {
    const found = await repository.findByOrganization(oid('missing-org'));

    expect(found).toBeNull();
  });

  it('upsert is idempotent: a second call for the same org updates the existing singleton, not a duplicate', async () => {
    await repository.upsert(buildConfig('config-1'));
    await repository.upsert(buildConfig('config-1').update({ slaCriticalMinutes: 15 }, LATER));

    const documents = await db
      .collection<OrganizationFraudConfigDocument>('organization_fraud_config')
      .find({ organization_id: new ObjectId(oid('org-1')) })
      .toArray();

    expect(documents).toHaveLength(1);
    expect(documents[0]?.sla_critical_minutes).toBe(15);
  });

  /**
   * Regression guard for the `org_fraud_config_unique` index: a raw insert
   * bypassing the repository's upsert-by-OrganizationId path (e.g. a second
   * document minted with a DIFFERENT `_id` for the same org) MUST be
   * rejected by Mongo itself — the index name, not app code, is the
   * invariant guard (design: "duplicate org rejected via
   * org_fraud_config_unique index + duplicateKey.ts translation").
   */
  it('rejects a raw duplicate OrganizationId insert via the org_fraud_config_unique index', async () => {
    await repository.upsert(buildConfig('config-1'));

    let caughtError: unknown;
    try {
      await db.collection<OrganizationFraudConfigDocument>('organization_fraud_config').insertOne({
        _id: new ObjectId(oid('config-2')),
        organization_id: new ObjectId(oid('org-1')),
        sla_low_minutes: 240,
        sla_medium_minutes: 120,
        sla_high_minutes: 60,
        sla_critical_minutes: 30,
        risk_threshold_low: 25,
        risk_threshold_medium: 50,
        risk_threshold_high: 75,
        risk_threshold_critical: 90,
        feature_flags: {},
        created_at: toDate(NOW),
        updated_at: toDate(NOW),
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(extractDuplicateKeyIndexName(caughtError)).toBe('org_fraud_config_unique');
  });

  it('round-trips the raw document by _id as a native ObjectId', async () => {
    await repository.upsert(buildConfig('config-id-guard'));

    const rawDocument = await db
      .collection<OrganizationFraudConfigDocument>('organization_fraud_config')
      .findOne({ organization_id: new ObjectId(oid('org-1')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBeInstanceOf(ObjectId);
    expect(rawDocument?._id.toString()).toBe(oid('config-id-guard'));
  });
});
