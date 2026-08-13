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
import { createRouteCaseUseCase } from '../../../src/modules/case-management/application/RouteCase.js';
import { MongoCaseRoutingRuleRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRoutingRuleRepository.js';
import { MongoOrganizationFraudConfigRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoOrganizationFraudConfigRepository.js';
import { ZenRoutingEngine } from '../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import type { AuditEvent, AuditRecorder } from '../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { generateCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';

jest.setTimeout(120_000);

const ANALYST = createAuthContext({ userId: 'analyst-1', organizationId: 'org-1', actorType: 'USER' });

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
    await db.collection('Cases').deleteMany({});
    await db.collection('CaseTimeline').deleteMany({});
    await db.collection('AuditLogs').deleteMany({});
    await db.collection('CaseRoutingRules').deleteMany({});
    await db.collection('OrganizationFraudConfig').deleteMany({});
  });

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
    await db.collection('CaseRoutingRules').insertOne({
      _id,
      OrganizationId: 'org-1',
      Name: 'high-risk',
      Conditions: jdm('auto-user', 'targetUserId'),
      ConditionsVersion: 5,
      TargetRoleId: null,
      TargetUserId: null,
      Status: 'ACTIVE',
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
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

  function buildUseCase(auditRecorder: AuditRecorder) {
    const routeCase = createRouteCaseUseCase({
      cases,
      routingRules: new MongoCaseRoutingRuleRepository(db),
      routingEngine: new ZenRoutingEngine(),
      timelineRecorder,
      auditRecorder,
      fraudConfig: new MongoOrganizationFraudConfigRepository(db),
      clock: new SystemClock(),
      generateTimelineEventId,
    });
    return createCreateCaseUseCase({
      cases,
      timelineRecorder,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      generateCaseId,
      generateTimelineEventId,
      auditRecorder,
      routeCase,
    });
  }

  it('commits the Case (Status OPEN), a CASE_CREATED timeline entry, and exactly one CREATE_CASE audit row', async () => {
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId });
    const createCase = buildUseCase(createCaseManagementAuditRecorderAdapter(recordAuditLog));

    const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42 });

    expect(kase.status).toBe('OPEN');
    const persisted = await cases.findById(kase.id);
    expect(persisted?.status).toBe('OPEN');
    expect(persisted?.organizationId).toBe('org-1');

    const timelineRows = await db.collection('CaseTimeline').find({ CaseId: new ObjectId(kase.id) }).toArray();
    expect(timelineRows).toHaveLength(1);
    expect(timelineRows[0]?.EventType).toBe('CASE_CREATED');

    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.Action).toBe('CREATE_CASE');
    expect(auditRows[0]?.Resource).toBe('case');
  });

  it('rolls back the Case write and the timeline entry when the audit write fails mid-transaction (proves the write is truly inside the tx)', async () => {
    const createCase = buildUseCase(alwaysFailingRecorder());

    await expect(
      createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42 }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persistedCases = await db.collection('Cases').find({}).toArray();
    expect(persistedCases).toHaveLength(0);
    const timelineRows = await db.collection('CaseTimeline').find({}).toArray();
    expect(timelineRows).toHaveLength(0);
    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
  });

  /**
   * T1 auto-routing (CASE-002) end to end on the real topology: ZEN evaluates
   * the stored JDM and the assignment, its ASSIGNED timeline entry and the
   * REASSIGN_CASE provenance row all land in the SAME transaction as the case.
   */
  describe('T1 auto-routing', () => {
    it('assigns the case to the rule target and persists AssignedTo/AssignedToType split', async () => {
      await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toEqual({ type: 'USER', id: 'auto-user' });
      const persisted = await db.collection('Cases').findOne({ _id: new ObjectId(kase.id) });
      expect(persisted?.AssignedTo).toBe('auto-user');
      expect(persisted?.AssignedToType).toBe('USER');
    });

    it('assigns a ROLE target when the JDM outputs targetRoleId', async () => {
      await seedRule({ Conditions: jdm('role-9', 'targetRoleId') });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 95, priority: 'HIGH' });

      expect(kase.assignedTo).toEqual({ type: 'ROLE', id: 'role-9' });
    });

    it('appends an ASSIGNED timeline entry alongside CASE_CREATED', async () => {
      await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      const rows = await db.collection('CaseTimeline').find({ CaseId: new ObjectId(kase.id) }).toArray();
      expect(rows.map((row) => row.EventType).sort()).toEqual(['ASSIGNED', 'CASE_CREATED']);
    });

    it('records a REASSIGN_CASE audit row tracing the rule id and conditionsVersion that assigned the case', async () => {
      const ruleId = await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      const row = await db.collection('AuditLogs').findOne({ Action: 'REASSIGN_CASE' });
      expect(row?.Detail).toMatchObject({
        trigger: 'AUTO_ROUTING',
        ruleId: ruleId.toString(),
        conditionsVersion: 5,
        assignedToId: 'auto-user',
        assignedToType: 'USER',
      });
    });

    it('leaves the case unassigned when the active rule does not match', async () => {
      await seedRule();
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 10, priority: 'LOW' });

      expect(kase.assignedTo).toBeNull();
      expect(await db.collection('AuditLogs').countDocuments({ Action: 'REASSIGN_CASE' })).toBe(0);
    });

    it('ignores INACTIVE rules', async () => {
      await seedRule({ Status: 'INACTIVE' });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
    });

    it('ignores rules belonging to another organization', async () => {
      await seedRule({ OrganizationId: 'org-2' });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
    });

    it('commits the case anyway when a rule JDM is malformed, auditing the skipped rule', async () => {
      await seedRule({ Conditions: { nodes: 'not-a-graph' } });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
      expect(await db.collection('Cases').countDocuments({})).toBe(1);
      expect(await db.collection('AuditLogs').countDocuments({ Action: 'ROUTING_RULE_EVALUATION_FAILED' })).toBe(1);
    });

    it('skips routing entirely when the tenant set featureFlags.autoRouting to false', async () => {
      await seedRule();
      await db.collection('OrganizationFraudConfig').insertOne({
        _id: new ObjectId(),
        OrganizationId: 'org-1',
        SlaLowMinutes: 60,
        SlaMediumMinutes: 60,
        SlaHighMinutes: 60,
        SlaCriticalMinutes: 60,
        RiskThresholdLow: 25,
        RiskThresholdMedium: 50,
        RiskThresholdHigh: 75,
        RiskThresholdCritical: 90,
        FeatureFlags: { autoRouting: false },
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
      });
      const createCase = buildUseCase(realAuditRecorder());

      const kase = await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

      expect(kase.assignedTo).toBeNull();
      expect(await db.collection('CaseTimeline').countDocuments({ EventType: 'ASSIGNED' })).toBe(0);
    });
  });
});
