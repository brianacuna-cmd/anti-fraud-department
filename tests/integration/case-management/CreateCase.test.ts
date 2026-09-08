import { oid } from '../../support/oid.js';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { MongoTimelineRecorder } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineRecorder.js';
import { MongoUnitOfWork } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createCaseManagementAuditRecorderAdapter } from '../../../src/composition/caseManagementAuditRecorderAdapter.js';
import { createCreateCaseUseCase } from '../../../src/modules/case-management/application/CreateCase.js';
import { createCalculateSlaUseCase } from '../../../src/modules/case-management/application/CalculateSla.js';
import { createRouteCaseUseCase } from '../../../src/modules/case-management/application/RouteCase.js';
import { MongoCaseRoutingRuleRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRoutingRuleRepository.js';
import { MongoOrganizationFraudConfigRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoOrganizationFraudConfigRepository.js';
import { MongoCaseSlaTrackingRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseSlaTrackingRepository.js';
import { ZenRoutingEngine } from '../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { AllowAllAssigneeDirectory } from '../../helpers/case-management/AllowAllAssigneeDirectory.js';
import type { AuditEvent, AuditRecorder } from '../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { generateCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import { MongoOutboxEventRepository } from '../../../src/shared/outbox/mongo/MongoOutboxEventRepository.js';
import type { OutboxEvent } from '../../../src/shared/outbox/OutboxEvent.js';
import type { OutboxEventRepository } from '../../../src/shared/outbox/OutboxEventRepository.js';

jest.setTimeout(120_000);

const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: oid('org-1'), actorType: 'USER' });

function alwaysFailingRecorder(): AuditRecorder {
  return {
    async record(_event: AuditEvent, _tx?: Transaction): Promise<void> {
      throw new Error('induced audit failure mid-transaction');
    },
  };
}

/**
 * T5 manual case creation (design "Transaction boundaries: CreateCase
 * (T5)"): proves the Case insert + CaseTimeline CASE_CREATED entry +
 * CREATE_CASE audit row all commit inside ONE real Mongo transaction, and
 * that a failure anywhere in that transaction rolls back everything —
 * mirrors `createOrganizationAudit.test.ts`'s atomicity precedent.
 */
describe('CreateCase (integration, real replica-set Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let cases: MongoCaseRepository;
  let timelineRecorder: MongoTimelineRecorder;

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
    cases = new MongoCaseRepository(db);
    timelineRecorder = new MongoTimelineRecorder(db);
  });

  afterEach(async () => {
    await db.collection('cases').deleteMany({});
    await db.collection('case_timeline').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
    await db.collection('case_routing_rules').deleteMany({});
    await db.collection('organization_fraud_config').deleteMany({});
    await db.collection('case_sla_tracking').deleteMany({});
    await db.collection('outbox_events').deleteMany({});
  });

  async function seedFraudConfig(overrides: Record<string, unknown> = {}): Promise<void> {
    await db.collection('organization_fraud_config').insertOne({
      _id: new ObjectId(),
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
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    });
  }

  /** JDM: riskScore > 80 AND status == OPEN -> the given target. */
  function jdm(target: string, field: 'targetUserId' | 'targetRoleId'): Record<string, unknown> {
    return {
      contentType: 'application/vnd.gorules.decision',
      nodes: [
        { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
        {
          id: 'table',
          type: 'decisionTableNode',
          name: 'Routing',
          position: { x: 200, y: 0 },
          content: {
            hitPolicy: 'first',
            inputs: [
              { id: 'i1', name: 'Risk', field: 'riskScore' },
              { id: 'i2', name: 'Status', field: 'status' },
            ],
            outputs: [{ id: 'o1', name: 'Target', field }],
            rules: [{ _id: 'r1', i1: '> 80', i2: '"OPEN"', o1: `"${target}"` }],
          },
        },
        { id: 'output', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: 'e1', sourceId: 'input', targetId: 'table' },
        { id: 'e2', sourceId: 'table', targetId: 'output' },
      ],
    };
  }

  async function seedRule(overrides: Record<string, unknown> = {}): Promise<ObjectId> {
    const _id = new ObjectId();
    await db.collection('case_routing_rules').insertOne({
      _id,
      organization_id: new ObjectId(oid('org-1')),
      name: 'high-risk',
      conditions: jdm('auto-user', 'targetUserId'),
      conditions_version: 5,
      target_role_id: null,
      target_user_id: null,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    });
    return _id;
  }

  function realAuditRecorder(): AuditRecorder {
    const auditLogs = new MongoAuditLogRepository(db);
    return createCaseManagementAuditRecorderAdapter(
      createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId }),
    );
  }

  function buildUseCase(
    auditRecorder: AuditRecorder,
    outbox: OutboxEventRepository = new MongoOutboxEventRepository(db),
  ) {
    const clock = new SystemClock();
    const fraudConfig = new MongoOrganizationFraudConfigRepository(db);
    const routeCase = createRouteCaseUseCase({
      cases,
      routingRules: new MongoCaseRoutingRuleRepository(db),
      routingEngine: new ZenRoutingEngine(),
      timelineRecorder,
      auditRecorder,
      fraudConfig,
      assigneeDirectory: new AllowAllAssigneeDirectory(),
      clock,
      generateTimelineEventId,
    });
    const calculateSla = createCalculateSlaUseCase({
      cases,
      slaTracking: new MongoCaseSlaTrackingRepository(db),
      fraudConfig,
      clock,
      generateCaseSlaTrackingId,
    });
    return createCreateCaseUseCase({
      cases,
      timelineRecorder,
      unitOfWork: new MongoUnitOfWork(client),
      clock,
      generateCaseId,
      generateTimelineEventId,
      auditRecorder,
      routeCase,
      calculateSla,
      outbox,
      generateOutboxEventId,
    });
  }

  it('commits the Case (Status OPEN), a CASE_CREATED timeline entry, and exactly one CREATE_CASE audit row', async () => {
    await seedFraudConfig();
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId });
    const createCase = buildUseCase(createCaseManagementAuditRecorderAdapter(recordAuditLog));

    const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42 });

    expect(kase.status).toBe('OPEN');
    const persisted = await cases.findById(kase.id);
    expect(persisted?.status).toBe('OPEN');
    expect(persisted?.organizationId).toBe(oid('org-1'));

    const timelineRows = await db.collection('case_timeline').find({ case_id: new ObjectId(kase.id) }).toArray();
    expect(timelineRows).toHaveLength(1);
    expect(timelineRows[0]?.event_type).toBe('CASE_CREATED');

    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('CREATE_CASE');
    expect(auditRows[0]?.resource).toBe('case');

    const outboxRows = await db.collection('outbox_events').find({}).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.event_type).toBe('case.created');
    expect(outboxRows[0]?.aggregate_type).toBe('Case');
    expect(outboxRows[0]?.payload).toMatchObject({
      caseId: kase.id,
      organizationId: oid('org-1'),
      customerId: 'customer-1',
      assignedTo: null,
    });
  });

  it('rolls back the Case write and the timeline entry when the audit write fails mid-transaction (proves the write is truly inside the tx)', async () => {
    await seedFraudConfig();
    const createCase = buildUseCase(alwaysFailingRecorder());

    await expect(
      createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42 }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persistedCases = await db.collection('cases').find({}).toArray();
    expect(persistedCases).toHaveLength(0);
    const timelineRows = await db.collection('case_timeline').find({}).toArray();
    expect(timelineRows).toHaveLength(0);
    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
    expect(await db.collection('outbox_events').countDocuments({})).toBe(0);
  });

  it('rolls back the case.created outbox row when save succeeds and the transaction then fails', async () => {
    await seedFraudConfig();
    const inner = new MongoOutboxEventRepository(db);
    const createCase = buildUseCase(realAuditRecorder(), {
      async save(event: OutboxEvent, tx?: unknown): Promise<void> {
        await inner.save(event, tx);
        throw new Error('induced outbox post-save failure');
      },
    });

    await expect(
      createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42 }),
    ).rejects.toThrow('induced outbox post-save failure');

    expect(await db.collection('cases').countDocuments({})).toBe(0);
    expect(await db.collection('outbox_events').countDocuments({})).toBe(0);
  });

  /**
   * T1 auto-routing (CASE-002) end to end on the real topology: ZEN evaluates
   * the stored JDM and the assignment, its ASSIGNED timeline entry and the
   * REASSIGN_CASE provenance row all land in the SAME transaction as the case.
   */
  describe('T2 SLA on create', () => {
    it('persists dueDate and an ON_TRACK CaseSlaTracking row when fraud config exists', async () => {
      await seedFraudConfig({ sla_high_minutes: 60 });
      const createCase = buildUseCase(realAuditRecorder());

      const before = Date.now();
      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42, priority: 'HIGH' });
      const after = Date.now();

      expect(kase.dueDate).not.toBeNull();
      const dueMs = new Date(kase.dueDate!).getTime();
      expect(dueMs).toBeGreaterThanOrEqual(before + 60 * 60_000 - 5_000);
      expect(dueMs).toBeLessThanOrEqual(after + 60 * 60_000 + 5_000);

      const tracking = await db.collection('case_sla_tracking').findOne({ case_id: new ObjectId(kase.id) });
      expect(tracking?.status).toBe('ON_TRACK');
      expect(tracking?.notified_statuses).toEqual([]);
    });

    it('rolls back the case when OrganizationFraudConfig is missing', async () => {
      const createCase = buildUseCase(realAuditRecorder());

      await expect(
        createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42, priority: 'HIGH' }),
      ).rejects.toMatchObject({ code: 'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND' });

      expect(await db.collection('cases').countDocuments({})).toBe(0);
      expect(await db.collection('case_sla_tracking').countDocuments({})).toBe(0);
      expect(await db.collection('case_timeline').countDocuments({})).toBe(0);
    });
  });

  describe('idempotencyKey (RF-1..RF-4)', () => {
    it('short-circuits a repeated idempotencyKey and returns the already-persisted Case', async () => {
      await seedFraudConfig();
      const createCase = buildUseCase(realAuditRecorder());

      const first = await createCase({
        auth: ANALYST,
        customerId: 'customer-1',
        riskScore: 42,
        priority: 'HIGH',
        idempotencyKey: 'retry-1',
      });
      const second = await createCase({
        auth: ANALYST,
        customerId: 'customer-1',
        riskScore: 42,
        priority: 'HIGH',
        idempotencyKey: 'retry-1',
      });

      expect(second.id).toBe(first.id);
      expect(await db.collection('cases').countDocuments({})).toBe(1);
    });

    it('CONCURRENCY: two concurrent creates with the same idempotencyKey persist exactly one Case, both resolve to the same winner, no error surfaces', async () => {
      await seedFraudConfig();
      const createCase = buildUseCase(realAuditRecorder());

      const [first, second] = await Promise.all([
        createCase({
          auth: ANALYST,
          customerId: 'customer-1',
          riskScore: 42,
          priority: 'HIGH',
          idempotencyKey: 'concurrent-key',
        }),
        createCase({
          auth: ANALYST,
          customerId: 'customer-1',
          riskScore: 42,
          priority: 'HIGH',
          idempotencyKey: 'concurrent-key',
        }),
      ]);

      expect(first.id).toBe(second.id);
      expect(await db.collection('cases').countDocuments({})).toBe(1);
    });
  });

  describe('T1 auto-routing', () => {
    it('assigns the case to the rule target and persists AssignedTo/AssignedToType split', async () => {
      await seedFraudConfig();
      await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toEqual({ type: 'USER', id: 'auto-user' });
      const persisted = await db.collection('cases').findOne({ _id: new ObjectId(kase.id) });
      expect(persisted?.assigned_to).toBe('auto-user');
      expect(persisted?.assigned_to_type).toBe('USER');
    });

    it('assigns a ROLE target when the JDM outputs targetRoleId', async () => {
      await seedFraudConfig();
      await seedRule({ conditions: jdm('role-9', 'targetRoleId') });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 95, priority: 'HIGH' });

      expect(kase.assignedTo).toEqual({ type: 'ROLE', id: 'role-9' });
    });

    it('appends an ASSIGNED timeline entry alongside CASE_CREATED', async () => {
      await seedFraudConfig();
      await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      const rows = await db.collection('case_timeline').find({ case_id: new ObjectId(kase.id) }).toArray();
      expect(rows.map((row) => row.event_type).sort()).toEqual(['ASSIGNED', 'CASE_CREATED']);
    });

    it('records a REASSIGN_CASE audit row tracing the rule id and conditionsVersion that assigned the case', async () => {
      await seedFraudConfig();
      const ruleId = await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      const row = await db.collection('audit_logs').findOne({ action: 'REASSIGN_CASE' });
      expect(row?.detail).toMatchObject({
        trigger: 'AUTO_ROUTING',
        ruleId: ruleId.toString(),
        conditionsVersion: 5,
        assignedToId: 'auto-user',
        assignedToType: 'USER',
      });
    });

    it('leaves the case unassigned when the active rule does not match', async () => {
      await seedFraudConfig();
      await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 10, priority: 'LOW' });

      expect(kase.assignedTo).toBeNull();
      expect(await db.collection('audit_logs').countDocuments({ action: 'REASSIGN_CASE' })).toBe(0);
    });

    it('ignores INACTIVE rules', async () => {
      await seedFraudConfig();
      await seedRule({ status: 'INACTIVE' });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
    });

    it('ignores rules belonging to another organization', async () => {
      await seedFraudConfig();
      await seedRule({ organization_id: new ObjectId(oid('org-2')) });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
    });

    it('commits the case anyway when a rule JDM is malformed, auditing the skipped rule', async () => {
      await seedFraudConfig();
      await seedRule({ conditions: { nodes: 'not-a-graph' } });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
      expect(await db.collection('cases').countDocuments({})).toBe(1);
      expect(await db.collection('audit_logs').countDocuments({ action: 'ROUTING_RULE_EVALUATION_FAILED' })).toBe(1);
    });

    it('skips routing entirely when the tenant set featureFlags.autoRouting to false', async () => {
      await seedRule();
      await db.collection('organization_fraud_config').insertOne({
        _id: new ObjectId(),
        organization_id: new ObjectId(oid('org-1')),
        sla_low_minutes: 60,
        sla_medium_minutes: 60,
        sla_high_minutes: 60,
        sla_critical_minutes: 60,
        risk_threshold_low: 25,
        risk_threshold_medium: 50,
        risk_threshold_high: 75,
        risk_threshold_critical: 90,
        feature_flags: { autoRouting: false },
        created_at: new Date(),
        updated_at: new Date(),
      });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
      expect(await db.collection('case_timeline').countDocuments({ event_type: 'ASSIGNED' })).toBe(0);
    });
  });
});
