import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { MongoCaseRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { MongoTimelineRecorder } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineRecorder.js';
import { MongoUnitOfWork } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createReassignCaseUseCase } from '../../../src/modules/case-management/application/ReassignCase.js';
import { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { generateCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createRiskScore } from '../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { InMemoryAssigneeDirectory } from '../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { createCaseManagementAuditRecorderAdapter } from '../../../src/composition/caseManagementAuditRecorderAdapter.js';
import { createCaseManagementNotificationSenderAdapter } from '../../../src/composition/caseManagementNotificationSenderAdapter.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createSendNotificationUseCase } from '../../../src/modules/notifications/application/SendNotification.js';
import { MongoNotificationRepository } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationRepository.js';
import { MongoNotificationPreferenceRepository } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationPreferenceRepository.js';
import { createNotificationId } from '../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import type { NotificationDocument } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/documents/NotificationDocument.js';
import type { CaseDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const TARGET_USER = oid('analyst-2');

describe('ReassignCase rollback (integration, real replica-set Mongo end-to-end)', () => {
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
    await db.collection('cases').deleteMany({});
    await db.collection('case_timeline').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
    await db.collection('notifications').deleteMany({});
  });

  it('rolls back the entire transaction when the notification save fails (spec scenario 2)', async () => {
    const cases = new MongoCaseRepository(db);
    const timelineRecorder = new MongoTimelineRecorder(db);
    const unitOfWork = new MongoUnitOfWork(client);
    const assigneeDirectory = new InMemoryAssigneeDirectory();

    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: { now: () => NOW }, generateAuditLogId });
    const auditRecorder = createCaseManagementAuditRecorderAdapter(recordAuditLog);

    // A real, already-persisted notification row occupying the id the
    // fixed generator below will mint again. `MongoNotificationRepository.save`
    // does a plain `insertOne`, so this collision forces a genuine Mongo
    // E11000 duplicate-key failure inside the transaction — no stub/mock,
    // every collaborator here is the real production wiring (mirrors main.ts).
    const collidingId = createNotificationId(oid('notification-collision'));
    await db.collection<NotificationDocument>('notifications').insertOne({
      _id: new ObjectId(collidingId),
      organization_id: new ObjectId(ORG),
      recipient_user_id: new ObjectId(TARGET_USER),
      alert_type: 'CASE_ASSIGNED',
      channel: 'EMAIL',
      context: {},
      created_at: new Date(NOW),
    });

    const notifications = new MongoNotificationRepository(db);
    const preferences = new MongoNotificationPreferenceRepository(db);
    const sendNotification = createSendNotificationUseCase({
      notifications,
      preferences,
      clock: { now: () => NOW },
      generateNotificationId: () => collidingId,
    });
    const notificationSender = createCaseManagementNotificationSenderAdapter(sendNotification);

    const reassignCase = createReassignCaseUseCase({
      cases,
      timelineRecorder,
      auditRecorder,
      unitOfWork,
      clock: { now: () => NOW },
      generateTimelineEventId,
      assigneeDirectory,
      notificationSender,
    });

    const caseId = generateCaseId();
    const original = Case.create({
      id: caseId,
      organizationId: ORG,
      customerId: 'customer-1',
      riskScore: createRiskScore(40),
      priority: 'MEDIUM',
      now: NOW,
    });
    await cases.save(original);
    assigneeDirectory.allow(ORG, createAssignedTo('USER', TARGET_USER));

    await expect(
      reassignCase({
        auth: createAuthContext({ userId: oid('analyst-1'), organizationId: ORG, actorType: 'USER' }),
        caseId,
        assignedToType: 'USER',
        assignedToId: TARGET_USER,
      }),
    ).rejects.toThrow();

    const persistedCase = await db.collection<CaseDocument>('cases').findOne({ _id: new ObjectId(caseId) });
    expect(persistedCase?.assigned_to).toBeNull();

    const timelineCount = await db.collection('case_timeline').countDocuments({ case_id: new ObjectId(caseId) });
    expect(timelineCount).toBe(0);

    const auditCount = await db.collection('audit_logs').countDocuments({ resource_id: caseId });
    expect(auditCount).toBe(0);

    const notificationCount = await db.collection('notifications').countDocuments({});
    expect(notificationCount).toBe(1); // only the pre-seeded row that caused the collision
  });
});
