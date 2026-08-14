import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../../helpers/mongoTestServer.js';

jest.setTimeout(120_000);

describe('ensureIndexes (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

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

  it('creates the required indexes on a fresh database, with snake_case collection and field keys (design A2/A3) and camelCase for AdminOrganization (design D39)', async () => {
    await ensureIndexes(db);

    const organizationIndexes = await db.collection('organizations').indexes();
    const userIndexes = await db.collection('users').indexes();
    const adminOrganizationIndexes = await db.collection('admin_organizations').indexes();

    const slugIndex = organizationIndexes.find((index) => index.name === 'slug_unique');
    expect(slugIndex).toBeDefined();
    expect(slugIndex?.key).toEqual({ slug: 1 });
    expect(slugIndex?.unique).toBe(true);

    const useremailIndex = userIndexes.find((index) => index.name === 'user_email_unique');
    expect(useremailIndex).toBeDefined();
    expect(useremailIndex?.key).toEqual({ organization_id: 1, email: 1 });
    expect(useremailIndex?.unique).toBe(true);

    const userstatusIndex = userIndexes.find((index) => index.name === 'user_status_idx');
    expect(userstatusIndex).toBeDefined();
    expect(userstatusIndex?.key).toEqual({ organization_id: 1, status: 1 });

    const adminemailIndex = adminOrganizationIndexes.find(
      (index) => index.name === 'admin_organization_email_unique',
    );
    expect(adminemailIndex).toBeDefined();
    expect(adminemailIndex?.key).toEqual({ email: 1 });
    expect(adminemailIndex?.unique).toBe(true);

    const adminKeysKeyIdIndex = adminOrganizationIndexes.find(
      (index) => index.name === 'admin_organization_keys_key_id_idx',
    );
    expect(adminKeysKeyIdIndex).toBeDefined();
    expect(adminKeysKeyIdIndex?.key).toEqual({ 'keys.key_id': 1 });
  });

  it('is idempotent — running it twice does not throw or duplicate indexes', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const userIndexes = await db.collection('users').indexes();
    const matchingNames = userIndexes.filter((index) => index.name === 'user_email_unique');
    expect(matchingNames).toHaveLength(1);
  });

  it('creates the required sessions indexes: unique token_hash and idx_expired_active on (expira_en, deleted_at)', async () => {
    await ensureIndexes(db);

    const sessionIndexes = await db.collection('sessions').indexes();

    const tokenHashIndex = sessionIndexes.find((index) => index.name === 'session_token_hash_unique');
    expect(tokenHashIndex).toBeDefined();
    expect(tokenHashIndex?.key).toEqual({ token_hash: 1 });
    expect(tokenHashIndex?.unique).toBe(true);

    const expiredActiveIndex = sessionIndexes.find((index) => index.name === 'idx_expired_active');
    expect(expiredActiveIndex).toBeDefined();
    expect(expiredActiveIndex?.key).toEqual({ expira_en: 1, deleted_at: 1 });
  });

  it('creates a PARTIAL (not sparse) unique index on Organizations.email (Phase 4, design D36 pulled forward, D38 general rule)', async () => {
    await ensureIndexes(db);

    const organizationIndexes = await db.collection('organizations').indexes();
    const emailIndex = organizationIndexes.find((index) => index.name === 'organization_email_unique');

    expect(emailIndex).toBeDefined();
    expect(emailIndex?.key).toEqual({ email: 1 });
    expect(emailIndex?.unique).toBe(true);
    expect(emailIndex?.sparse).not.toBe(true);
    expect(emailIndex?.partialFilterExpression).toEqual({ email: { $exists: true, $type: 'string' } });
  });

  it('creates a unique compound index on NotificationPreferences (organization_id, user_id, alert_type, channel) (notification-preferences, design D9)', async () => {
    await ensureIndexes(db);

    const notificationPreferenceIndexes = await db.collection('notification_preferences').indexes();
    const compoundIndex = notificationPreferenceIndexes.find(
      (index) => index.name === 'notification_preference_user_alert_channel_unique',
    );

    expect(compoundIndex).toBeDefined();
    expect(compoundIndex?.key).toEqual({ organization_id: 1, user_id: 1, alert_type: 1, channel: 1 });
    expect(compoundIndex?.unique).toBe(true);
  });

  it('creates the six Cases indexes (case-management Slice 1 — Foundation) and stays idempotent on re-run', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const caseIndexes = await db.collection('cases').indexes();

    const orgstatusIndex = caseIndexes.find((index) => index.name === 'case_org_status_idx');
    expect(orgstatusIndex?.key).toEqual({ organization_id: 1, status: 1 });

    const orgpriorityIndex = caseIndexes.find((index) => index.name === 'case_org_priority_idx');
    expect(orgpriorityIndex?.key).toEqual({ organization_id: 1, priority: 1 });

    const assignedToIndex = caseIndexes.find((index) => index.name === 'case_assigned_to_idx');
    expect(assignedToIndex?.key).toEqual({ assigned_to: 1 });

    const riskScoreIndex = caseIndexes.find((index) => index.name === 'case_risk_score_idx');
    expect(riskScoreIndex?.key).toEqual({ risk_score: 1 });

    const dueDateIndex = caseIndexes.find((index) => index.name === 'case_due_date_idx');
    expect(dueDateIndex?.key).toEqual({ due_date: 1 });

    const tagsIndex = caseIndexes.find((index) => index.name === 'case_tags_idx');
    expect(tagsIndex?.key).toEqual({ tags: 1 });

    const matchingNames = caseIndexes.filter((index) => index.name === 'case_org_status_idx');
    expect(matchingNames).toHaveLength(1);
  });

  it('creates the OrganizationFraudConfig unique index (case-management Slice 2) and stays idempotent on re-run', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const configIndexes = await db.collection('organization_fraud_config').indexes();
    const uniqueIndex = configIndexes.find((index) => index.name === 'org_fraud_config_unique');

    expect(uniqueIndex?.key).toEqual({ organization_id: 1 });
    expect(uniqueIndex?.unique).toBe(true);

    const matchingNames = configIndexes.filter((index) => index.name === 'org_fraud_config_unique');
    expect(matchingNames).toHaveLength(1);
  });

  it('creates the CaseRoutingRules org+status index and stays idempotent on re-run', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const routingIndexes = await db.collection('case_routing_rules').indexes();
    const orgStatusIndex = routingIndexes.find((index) => index.name === 'case_routing_rules_org_status_idx');

    expect(orgStatusIndex?.key).toEqual({ organization_id: 1, status: 1 });
    expect(routingIndexes.filter((index) => index.name === 'case_routing_rules_org_status_idx')).toHaveLength(1);
  });

  it('creates a unique partial ACTIVE index on RiskScoringRules and drops the old non-unique org+status index', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const scoringIndexes = await db.collection('risk_scoring_rules').indexes();
    const activeUnique = scoringIndexes.find((index) => index.name === 'risk_scoring_rules_org_active_unique');

    expect(activeUnique?.key).toEqual({ organization_id: 1 });
    expect(activeUnique?.unique).toBe(true);
    expect(activeUnique?.partialFilterExpression).toEqual({ status: 'ACTIVE' });
    expect(scoringIndexes.filter((index) => index.name === 'risk_scoring_rules_org_active_unique')).toHaveLength(1);
    expect(scoringIndexes.find((index) => index.name === 'risk_scoring_rules_org_status_idx')).toBeUndefined();
  });

  it('rejects a second ACTIVE risk_scoring_rules insert for the same organization with E11000', async () => {
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('risk_scoring_rules').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      name: 'first-active',
      conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
      conditions_version: 1,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    await expect(
      db.collection('risk_scoring_rules').insertOne({
        _id: new ObjectId(),
        organization_id: organizationId,
        name: 'second-active',
        conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('still allows multiple ACTIVE case_routing_rules for the same organization', async () => {
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('case_routing_rules').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      name: 'route-a',
      conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
      conditions_version: 1,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });
    await db.collection('case_routing_rules').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      name: 'route-b',
      conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
      conditions_version: 1,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    const count = await db.collection('case_routing_rules').countDocuments({
      organization_id: organizationId,
      status: 'ACTIVE',
    });
    expect(count).toBe(2);
  });

  it('fails closed when unique ACTIVE index creation is attempted while ACTIVE duplicates remain', async () => {
    // Seed duplicate ACTIVE rows before indexes exist on this collection path.
    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('risk_scoring_rules').deleteMany({});
    // Drop any prior unique index from earlier tests so we can re-attempt creation.
    try {
      await db.collection('risk_scoring_rules').dropIndex('risk_scoring_rules_org_active_unique');
    } catch {
      // index may not exist yet on first failure path
    }
    try {
      await db.collection('risk_scoring_rules').dropIndex('risk_scoring_rules_org_status_idx');
    } catch {
      // optional legacy index
    }

    await db.collection('risk_scoring_rules').insertMany([
      {
        _id: new ObjectId(),
        organization_id: organizationId,
        name: 'dup-a',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      },
      {
        _id: new ObjectId(),
        organization_id: organizationId,
        name: 'dup-b',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      },
    ]);

    await expect(ensureIndexes(db)).rejects.toMatchObject({ code: 11000 });
  });
});
