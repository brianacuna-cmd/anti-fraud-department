import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { MongoTimelineRecorder } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineRecorder.js';
import { MongoOutboxRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoOutboxRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createCaseManagementAuditRecorderAdapter } from '../../../src/composition/caseManagementAuditRecorderAdapter.js';
import { createIngestFinturuCaseUseCase } from '../../../src/modules/case-management/application/IngestFinturuCase.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createInitializeCaseSlaService } from '../../../src/modules/case-management/application/InitializeCaseSla.js';
import { MongoCaseSlaTrackingRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseSlaTrackingRepository.js';
import { MongoOrganizationFraudConfigRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoOrganizationFraudConfigRepository.js';
import { generateCaseSlaTrackingId } from '../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';

jest.setTimeout(120_000);

const ORG_A = '019d7e58aed0777318d11d4d';
const ORG_B = '019d7e58aed0777318d11d99';

/**
 * CASE-011's guard. Every case here pins a defect that shipped: the lookup
 * ignored `Status` (so a closed file swallowed a repeat report), it retried
 * without `OrganizationId` (so one tenant's intake could adopt another's
 * case), and the update branch wrote no timeline entry (so the repeat report
 * left no trace an analyst could see).
 */
describe('IngestFinturuCase deduplication (integration)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_dedup_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(async () => {
    await db.collection('Cases').deleteMany({});
    await db.collection('CaseTimeline').deleteMany({});
    await db.collection('OutboxEvents').deleteMany({});
  });

  function buildIngest() {
    const clock = new SystemClock();
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock, generateAuditLogId });
    return createIngestFinturuCaseUseCase({
      cases: new MongoCaseRepository(db),
      timelineRecorder: new MongoTimelineRecorder(db),
      outbox: new MongoOutboxRepository(db),
      unitOfWork: new MongoUnitOfWork(client),
      clock,
      generateCaseId,
      generateTimelineEventId,
      auditRecorder: createCaseManagementAuditRecorderAdapter(recordAuditLog),
      initializeCaseSla: createInitializeCaseSlaService({
        slaTracking: new MongoCaseSlaTrackingRepository(db),
        fraudConfig: new MongoOrganizationFraudConfigRepository(db),
        generateCaseSlaTrackingId,
      }),
    });
  }

  const payload = (overrides: Record<string, unknown> = {}) => ({
    organization_id: ORG_A,
    idUser: 'usr_dedup_1',
    idUserBridge: 'cus_bridge_dedup_1',
    email: 'dedup@finturu.com',
    risk_score: 60,
    ...overrides,
  });

  it('reuses the existing case when one is already OPEN for the same customer', async () => {
    const ingest = buildIngest();

    const first = await ingest({ rawPayload: payload(), organizationId: ORG_A });
    const second = await ingest({ rawPayload: payload({ risk_score: 85 }), organizationId: ORG_A });

    expect(second.case.id).toBe(first.case.id);
    expect(second.case.riskScore).toBe(85);
    await expect(db.collection('Cases').countDocuments({ OrganizationId: ORG_A })).resolves.toBe(1);
  });

  it('records a SNAPSHOT_REFRESHED timeline entry instead of absorbing the repeat report silently', async () => {
    const ingest = buildIngest();

    const first = await ingest({ rawPayload: payload(), organizationId: ORG_A });
    await ingest({ rawPayload: payload({ risk_score: 91 }), organizationId: ORG_A });

    const events = await db
      .collection('CaseTimeline')
      .find({ CaseId: { $exists: true } })
      .toArray();
    const types = events.map((e) => e.EventType);

    expect(types).toContain('CASE_CREATED');
    expect(types).toContain('SNAPSHOT_REFRESHED');

    const refreshed = events.find((e) => e.EventType === 'SNAPSHOT_REFRESHED');
    expect(String(refreshed?.CaseId)).toBe(first.case.id);
    expect(refreshed?.NewValue).toBe('91');
  });

  it('publishes an outbox event for the refresh, not a fabricated id', async () => {
    const ingest = buildIngest();

    await ingest({ rawPayload: payload(), organizationId: ORG_A });
    const second = await ingest({ rawPayload: payload({ risk_score: 70 }), organizationId: ORG_A });

    expect(second.outboxEventId).not.toMatch(/^outbox_update_/);
    const event = await db.collection('OutboxEvents').findOne({ EventType: 'case.snapshot_refreshed' });
    expect(event).not.toBeNull();
    expect(String(event?.AggregateId)).toBe(second.case.id);
    expect(event?.Status).toBe('PENDING');
  });

  it('opens a NEW case when the only prior case for that customer is already RESOLVED', async () => {
    const ingest = buildIngest();

    const first = await ingest({ rawPayload: payload(), organizationId: ORG_A });
    // El expediente se cierra; el cliente reincide más tarde.
    await db.collection('Cases').updateOne({ CustomerId: 'usr_dedup_1' }, { $set: { Status: 'RESOLVED' } });

    const second = await ingest({ rawPayload: payload({ risk_score: 95 }), organizationId: ORG_A });

    expect(second.case.id).not.toBe(first.case.id);
    expect(second.case.status).toBe('OPEN');
    await expect(db.collection('Cases').countDocuments({ CustomerId: 'usr_dedup_1' })).resolves.toBe(2);
  });

  it('never adopts another tenant’s case, even on an exact customer-id match', async () => {
    const ingest = buildIngest();

    const orgACase = await ingest({ rawPayload: payload(), organizationId: ORG_A });
    const orgBCase = await ingest({ rawPayload: payload({ organization_id: ORG_B }), organizationId: ORG_B });

    expect(orgBCase.case.id).not.toBe(orgACase.case.id);
    expect(orgBCase.case.organizationId).toBe(ORG_B);
    await expect(db.collection('Cases').countDocuments({ CustomerId: 'usr_dedup_1' })).resolves.toBe(2);
  });
});
