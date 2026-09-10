import { oid } from '../../support/oid.js';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoNotificationPreferenceRepository } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationPreferenceRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createSetNotificationPreferencesUseCase } from '../../../src/modules/notifications/application/SetNotificationPreferences.js';
import { createNotificationsAuditRecorderAdapter } from '../../../src/composition/notificationsAuditRecorderAdapter.js';
import type { AuditEvent, AuditRecorder } from '../../../src/modules/notifications/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/notifications/domain/ports/UnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../helpers/FixedClock.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

/**
 * PR2a: bulk `SetNotificationPreferences` wired through the REAL
 * composition — real Mongo replica-set transaction + the cross-module audit
 * bridge. Proves N preference rows AND N audit rows commit together, and
 * that a mid-batch persistence failure rolls back every entry in the batch.
 */
describe('SetNotificationPreferences bulk atomicity (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

  const auth = createAuthContext({
    userId: oid('user-1'),
    organizationId: oid('org-1'),
    actorType: 'USER',
    sessionId: oid('session-1'),
  });

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
    await db.collection('notification_preferences').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
  });

  function buildRecordAuditLog() {
    return createRecordAuditLogUseCase({
      auditLogs: new MongoAuditLogRepository(db),
      clock: new FixedClock(NOW),
      generateAuditLogId,
    });
  }

  it('persists N rows and N audit rows atomically for a valid batch', async () => {
    const setPreferences = createSetNotificationPreferencesUseCase({
      repository: new MongoNotificationPreferenceRepository(db),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new FixedClock(NOW),
      auditRecorder: createNotificationsAuditRecorderAdapter(buildRecordAuditLog()),
    });

    await setPreferences({
      auth,
      entries: [
        { alertType: 'CASE_ASSIGNED', channel: 'EMAIL', enabled: false },
        { alertType: 'SLA_DUE_SOON', channel: 'SLACK', enabled: true },
        { alertType: 'CRITICAL_RISK', channel: 'WEBHOOK', enabled: false },
      ],
    });

    const prefCount = await db.collection('notification_preferences').countDocuments({
      organization_id: new ObjectId(oid('org-1')),
      user_id: new ObjectId(oid('user-1')),
    });
    expect(prefCount).toBe(3);
    const auditCount = await db.collection('audit_logs').countDocuments({ action: 'NOTIFICATION_PREFERENCE_UPDATED' });
    expect(auditCount).toBe(3);
  });

  it('leaves NOTHING persisted when the second of three entries fails inside the transaction', async () => {
    const realAdapter = createNotificationsAuditRecorderAdapter(buildRecordAuditLog());
    let calls = 0;
    const faultyAuditRecorder: AuditRecorder = {
      async record(event: AuditEvent, tx?: Transaction): Promise<void> {
        calls += 1;
        if (calls === 2) {
          throw new Error('audit bridge boom (mid-batch)');
        }
        await realAdapter.record(event, tx);
      },
    };

    const setPreferences = createSetNotificationPreferencesUseCase({
      repository: new MongoNotificationPreferenceRepository(db),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new FixedClock(NOW),
      auditRecorder: faultyAuditRecorder,
    });

    await expect(
      setPreferences({
        auth,
        entries: [
          { alertType: 'CASE_ASSIGNED', channel: 'EMAIL', enabled: false },
          { alertType: 'SLA_DUE_SOON', channel: 'SLACK', enabled: true },
          { alertType: 'CRITICAL_RISK', channel: 'WEBHOOK', enabled: false },
        ],
      }),
    ).rejects.toThrow('audit bridge boom (mid-batch)');

    const prefCount = await db.collection('notification_preferences').countDocuments({});
    const auditCount = await db.collection('audit_logs').countDocuments({});
    expect(prefCount).toBe(0);
    expect(auditCount).toBe(0);
  });

  it('leaves NOTHING persisted when a mid-batch entry fails validation (IN_APP), before any transaction opens', async () => {
    const setPreferences = createSetNotificationPreferencesUseCase({
      repository: new MongoNotificationPreferenceRepository(db),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new FixedClock(NOW),
      auditRecorder: createNotificationsAuditRecorderAdapter(buildRecordAuditLog()),
    });

    await expect(
      setPreferences({
        auth,
        entries: [
          { alertType: 'CASE_ASSIGNED', channel: 'EMAIL', enabled: false },
          { alertType: 'SLA_DUE_SOON', channel: 'IN_APP', enabled: true },
          { alertType: 'CRITICAL_RISK', channel: 'WEBHOOK', enabled: false },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_CHANNEL_NOT_CONFIGURABLE' });

    const prefCount = await db.collection('notification_preferences').countDocuments({});
    const auditCount = await db.collection('audit_logs').countDocuments({});
    expect(prefCount).toBe(0);
    expect(auditCount).toBe(0);
  });
});
