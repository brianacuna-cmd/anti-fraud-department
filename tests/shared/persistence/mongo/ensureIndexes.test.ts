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

  it('creates a unique PARTIAL idempotency-key index on Cases (case-create-idempotency, Slice 1) and stays idempotent on re-run', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const caseIndexes = await db.collection('cases').indexes();
    const idempotencyIndex = caseIndexes.find((index) => index.name === 'case_org_idempotency_key_unique');

    expect(idempotencyIndex).toBeDefined();
    expect(idempotencyIndex?.key).toEqual({ organization_id: 1, idempotency_key: 1 });
    expect(idempotencyIndex?.unique).toBe(true);
    expect(idempotencyIndex?.sparse).not.toBe(true);
    expect(idempotencyIndex?.partialFilterExpression).toEqual({
      idempotency_key: { $exists: true, $type: 'string' },
    });
    expect(
      caseIndexes.filter((index) => index.name === 'case_org_idempotency_key_unique'),
    ).toHaveLength(1);
  });

  it('rejects a second Case with the same organization_id + idempotency_key with E11000', async () => {
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('cases').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      customer_id: 'customer-1',
      idempotency_key: 'idem-dup',
      status: 'OPEN',
      priority: 'LOW',
      risk_score: 1,
      tags: [],
      created_at: now,
      updated_at: now,
    });

    await expect(
      db.collection('cases').insertOne({
        _id: new ObjectId(),
        organization_id: organizationId,
        customer_id: 'customer-2',
        idempotency_key: 'idem-dup',
        status: 'OPEN',
        priority: 'LOW',
        risk_score: 1,
        tags: [],
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toMatchObject({ code: 11000 });

    await db.collection('cases').deleteMany({});
  });

  it('allows multiple Cases with a null/absent idempotency_key for the same organization', async () => {
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('cases').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      customer_id: 'customer-1',
      idempotency_key: null,
      status: 'OPEN',
      priority: 'LOW',
      risk_score: 1,
      tags: [],
      created_at: now,
      updated_at: now,
    });
    await db.collection('cases').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      customer_id: 'customer-2',
      idempotency_key: null,
      status: 'OPEN',
      priority: 'LOW',
      risk_score: 1,
      tags: [],
      created_at: now,
      updated_at: now,
    });

    const count = await db.collection('cases').countDocuments({ organization_id: organizationId });
    expect(count).toBe(2);

    await db.collection('cases').deleteMany({});
  });

  it('creates the aml_alerts filter indexes (screening inbox triage Slice 2) and drops obsolete Spanish-named indexes', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const alertIndexes = await db.collection('aml_alerts').indexes();

    const orgStatusCreatedIndex = alertIndexes.find(
      (index) => index.name === 'aml_alert_org_status_created_idx',
    );
    expect(orgStatusCreatedIndex?.key).toEqual({ organization_id: 1, status: 1, created_at: -1 });

    const orgSeverityIndex = alertIndexes.find((index) => index.name === 'aml_alert_org_severity_idx');
    expect(orgSeverityIndex?.key).toEqual({ organization_id: 1, severity: 1 });

    const orgWatchlistIndex = alertIndexes.find((index) => index.name === 'aml_alert_org_watchlist_idx');
    expect(orgWatchlistIndex?.key).toEqual({ organization_id: 1, 'matched_entry.watchlist_id': 1 });

    expect(alertIndexes.find((index) => index.name === 'aml_alert_org_estado_idx')).toBeUndefined();
    expect(alertIndexes.find((index) => index.name === 'aml_alert_org_estado_created_idx')).toBeUndefined();
    expect(alertIndexes.find((index) => index.name === 'aml_alert_org_severidad_idx')).toBeUndefined();

    expect(
      alertIndexes.filter((index) => index.name === 'aml_alert_org_status_created_idx'),
    ).toHaveLength(1);
  });

  it('creates watchlist_entries blocking indexes and drops obsolete Spanish-named indexes', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const watchlistIndexes = await db.collection('watchlist_entries').indexes();

    expect(watchlistIndexes.find((index) => index.name === 'watchlist_entries_watchlist_status_idx')?.key).toEqual({
      watchlist_id: 1,
      status: 1,
    });
    expect(watchlistIndexes.find((index) => index.name === 'watchlist_entries_document_idx')?.key).toEqual({
      document: 1,
    });
    expect(watchlistIndexes.find((index) => index.name === 'watchlist_entries_phonetic_keys_idx')?.key).toEqual({
      phonetic_keys: 1,
    });
    expect(watchlistIndexes.find((index) => index.name === 'watchlist_entries_normalized_name_idx')?.key).toEqual({
      normalized_name: 1,
    });

    expect(watchlistIndexes.find((index) => index.name === 'watchlist_entries_watchlist_estado_idx')).toBeUndefined();
    expect(watchlistIndexes.find((index) => index.name === 'watchlist_entries_documento_idx')).toBeUndefined();
    expect(watchlistIndexes.find((index) => index.name === 'watchlist_entries_nombre_normalizado_idx')).toBeUndefined();
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

  it('creates the OrganizationScreeningConfig unique index (screening producer activation Slice 3) and stays idempotent on re-run', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const configIndexes = await db.collection('organization_screening_config').indexes();
    const uniqueIndex = configIndexes.find((index) => index.name === 'org_screening_config_unique');

    expect(uniqueIndex?.key).toEqual({ organization_id: 1 });
    expect(uniqueIndex?.unique).toBe(true);

    const matchingNames = configIndexes.filter((index) => index.name === 'org_screening_config_unique');
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

  it('creates enforcement + outbox indexes and stays idempotent on re-run', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const decisionIndexes = await db.collection('analyst_decisions').indexes();
    expect(
      decisionIndexes.find((index) => index.name === 'analyst_decisions_case_created_idx')?.key,
    ).toEqual({ case_id: 1, created_at: -1 });

    const actionIndexes = await db.collection('enforcement_actions').indexes();
    expect(
      actionIndexes.find((index) => index.name === 'enforcement_actions_case_status_idx')?.key,
    ).toEqual({ case_id: 1, status: 1 });
    expect(
      actionIndexes.find((index) => index.name === 'enforcement_actions_org_status_idx')?.key,
    ).toEqual({ organization_id: 1, status: 1 });

    const approvalIndexes = await db.collection('approval_requests').indexes();
    expect(approvalIndexes.find((index) => index.name === 'approval_requests_action_idx')?.key).toEqual({
      enforcement_action_id: 1,
    });

    const outboxIndexes = await db.collection('customer_outgoing_events').indexes();
    expect(
      outboxIndexes.find((index) => index.name === 'customer_outgoing_events_poll_idx')?.key,
    ).toEqual({ status: 1, last_attempt_at: 1 });
    expect(
      outboxIndexes.find((index) => index.name === 'customer_outgoing_events_action_idx')?.key,
    ).toEqual({ enforcement_action_id: 1 });
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

  async function restoreScoringRulesCollection(): Promise<void> {
    await db.collection('risk_scoring_rules').deleteMany({});
    try {
      await db.collection('risk_scoring_rules').dropIndex('risk_scoring_rules_org_active_unique');
    } catch {
      // may already be absent after the fail-closed duplicate-index test
    }
  }

  it('creates unique inbound webhook secrets index on (organization_id, provider)', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);
    await ensureIndexes(db);

    const indexes = await db.collection('organization_inbound_webhook_secrets').indexes();
    const uniqueIndex = indexes.find((index) => index.name === 'inbound_webhook_secret_org_provider_unique');

    expect(uniqueIndex?.key).toEqual({ organization_id: 1, provider: 1 });
    expect(uniqueIndex?.unique).toBe(true);
    expect(indexes.filter((index) => index.name === 'inbound_webhook_secret_org_provider_unique')).toHaveLength(1);
  });

  it('rejects a second inbound webhook secret for the same organization and provider with E11000', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('organization_inbound_webhook_secrets').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      provider: 'stripe',
      ciphertext: 'cipher-a',
      created_at: now,
      updated_at: now,
    });

    await expect(
      db.collection('organization_inbound_webhook_secrets').insertOne({
        _id: new ObjectId(),
        organization_id: organizationId,
        provider: 'stripe',
        ciphertext: 'cipher-b',
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows inbound webhook secrets for the same organization with different providers', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('organization_inbound_webhook_secrets').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      provider: 'stripe',
      ciphertext: 'cipher-stripe',
      created_at: now,
      updated_at: now,
    });
    await db.collection('organization_inbound_webhook_secrets').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      provider: 'bridge',
      ciphertext: 'cipher-bridge',
      created_at: now,
      updated_at: now,
    });

    const count = await db.collection('organization_inbound_webhook_secrets').countDocuments({
      organization_id: organizationId,
    });
    expect(count).toBe(2);
  });

  it('creates unique provider ingest event index on (organization_id, provider, provider_event_id)', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);
    await ensureIndexes(db);

    const indexes = await db.collection('provider_ingest_events').indexes();
    const uniqueIndex = indexes.find((index) => index.name === 'provider_ingest_event_org_provider_event_unique');

    expect(uniqueIndex?.key).toEqual({ organization_id: 1, provider: 1, provider_event_id: 1 });
    expect(uniqueIndex?.unique).toBe(true);
    expect(indexes.filter((index) => index.name === 'provider_ingest_event_org_provider_event_unique')).toHaveLength(
      1,
    );
  });

  it('rejects a duplicate provider ingest event for the same org, provider, and provider_event_id with E11000', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('provider_ingest_events').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      provider: 'coinflow',
      provider_event_id: 'Card Payment Authorized:pay_1:2026-01-01',
      status: 'RECEIVED',
      created_at: now,
      updated_at: now,
    });

    await expect(
      db.collection('provider_ingest_events').insertOne({
        _id: new ObjectId(),
        organization_id: organizationId,
        provider: 'coinflow',
        provider_event_id: 'Card Payment Authorized:pay_1:2026-01-01',
        status: 'RECEIVED',
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  // ─── watchlists (screening, Slice A2, design §7 / ADR-5) ───────────────────

  it('creates the required indexes on the watchlists collection', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const indexes = await db.collection('watchlists').indexes();

    const orgStatusIdx = indexes.find((i) => i.name === 'watchlists_org_status_idx');
    expect(orgStatusIdx).toBeDefined();
    expect(orgStatusIdx?.key).toEqual({ organization_id: 1, status: 1 });

    const orgTypeIdx = indexes.find((i) => i.name === 'watchlists_org_type_idx');
    expect(orgTypeIdx).toBeDefined();
    expect(orgTypeIdx?.key).toEqual({ organization_id: 1, type: 1 });

    const orgNameIdx = indexes.find((i) => i.name === 'watchlists_org_name_partial_unique');
    expect(orgNameIdx).toBeDefined();
    expect(orgNameIdx?.key).toEqual({ organization_id: 1, name: 1 });
    expect(orgNameIdx?.unique).toBe(true);
    expect(orgNameIdx?.partialFilterExpression).toEqual({ deleted_at: null });
  });

  it('rejects a duplicate watchlist name within the same org (partial unique index, non-deleted)', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('watchlists').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      status: 'ACTIVE',
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });

    await expect(
      db.collection('watchlists').insertOne({
        _id: new ObjectId(),
        organization_id: organizationId,
        name: 'OFAC List',
        source: 'OFAC',
        type: 'BLACKLIST',
        status: 'ACTIVE',
        deleted_at: null,
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same watchlist name to be reused after soft-delete (partial filter excludes deleted_at != null)', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const organizationId = new ObjectId();
    const now = new Date('2026-01-01T00:00:00.000Z');
    await db.collection('watchlists').insertOne({
      _id: new ObjectId(),
      organization_id: organizationId,
      name: 'Reusable List',
      source: 'OFAC',
      type: 'BLACKLIST',
      status: 'INACTIVE',
      deleted_at: now,
      created_at: now,
      updated_at: now,
    });

    // Inserting a non-deleted doc with the same name should succeed
    await expect(
      db.collection('watchlists').insertOne({
        _id: new ObjectId(),
        organization_id: organizationId,
        name: 'Reusable List',
        source: 'OFAC',
        type: 'BLACKLIST',
        status: 'ACTIVE',
        deleted_at: null,
        created_at: now,
        updated_at: now,
      }),
    ).resolves.toBeDefined();
  });

  it('creates dlq_exhausted_idx on dead_letter_queue for cross-tenant DLQ admin list (D4)', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const dlqIndexes = await db.collection('dead_letter_queue').indexes();
    const idx = dlqIndexes.find((i) => i.name === 'dlq_exhausted_idx');

    expect(idx).toBeDefined();
    expect(idx?.key).toEqual({ exhausted_at: -1, _id: -1 });
  });

  it('creates outbox_published_ttl_idx on outbox_events for PUBLISHED 7-day retention', async () => {
    await restoreScoringRulesCollection();
    await ensureIndexes(db);

    const indexes = await db.collection('outbox_events').indexes();
    const idx = indexes.find((i) => i.name === 'outbox_published_ttl_idx');

    expect(idx).toBeDefined();
    expect(idx?.key).toEqual({ published_at: 1 });
    expect(idx?.expireAfterSeconds).toBe(604800);
    expect(idx?.partialFilterExpression).toEqual({ status: 'PUBLISHED' });
  });
});
