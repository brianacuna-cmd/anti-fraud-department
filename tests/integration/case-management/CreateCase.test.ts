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
  });

  function buildUseCase(auditRecorder: AuditRecorder) {
    return createCreateCaseUseCase({
      cases,
      timelineRecorder,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      generateCaseId,
      generateTimelineEventId,
      auditRecorder,
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
});
