import { oid } from '../../support/oid.js';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoNotificationPreferenceRepository } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationPreferenceRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createSetNotificationPreferenceUseCase } from '../../../src/modules/notifications/application/SetNotificationPreference.js';
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
 * PR3 cross-module atomicity: `SetNotificationPreference` wired through the
 * REAL composition — notifications' own `MongoUnitOfWork` + the
 * `notificationsAuditRecorderAdapter` bridging to the `audit` module's
 * `RecordAuditLog`. Proves the preference row (NotificationPreferences) and
 * the audit row (AuditLogs) commit or roll back TOGETHER on a single
 * `ClientSession`, despite the two modules owning nominally-distinct
 * `Transaction` types (design D11/D12).
 */
describe('SetNotificationPreference atomicity (integration, real replica-set Mongo, cross-module audit)', () => {
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

  it('commits the preference row AND the audit row together on success', async () => {
    const setNotificationPreference = createSetNotificationPreferenceUseCase({
      repository: new MongoNotificationPreferenceRepository(db),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new FixedClock(NOW),
      auditRecorder: createNotificationsAuditRecorderAdapter(buildRecordAuditLog()),
    });

    await setNotificationPreference({ auth, alertType: 'CASO_ASIGNADO', channel: 'EMAIL', enabled: false });

    const prefRow = await db
      .collection('notification_preferences')
      .findOne({ organization_id: new ObjectId(oid('org-1')), user_id: new ObjectId(oid('user-1')), alert_type: 'CASO_ASIGNADO', channel: 'EMAIL' });
    expect(prefRow?.enabled).toBe(false);

    const auditRow = await db.collection('audit_logs').findOne({ action: 'NOTIFICATION_PREFERENCE_UPDATED' });
    expect(auditRow?.organization_id).toEqual(new ObjectId(oid('org-1')));
    expect(auditRow?.actor_id).toBe(oid('user-1'));
    expect(auditRow?.resource_id).toBe('CASO_ASIGNADO:EMAIL');
  });

  it('rolls BOTH writes back when the audit step fails inside the transaction', async () => {
    const realAdapter = createNotificationsAuditRecorderAdapter(buildRecordAuditLog());
    // Delegates to the real bridge (which writes the AuditLogs row on the tx
    // session) and THEN throws — aborting the transaction so both the audit
    // row and the preference upsert must roll back.
    const faultyAuditRecorder: AuditRecorder = {
      async record(event: AuditEvent, tx?: Transaction): Promise<void> {
        await realAdapter.record(event, tx);
        throw new Error('audit bridge boom (post-write)');
      },
    };

    const setNotificationPreference = createSetNotificationPreferenceUseCase({
      repository: new MongoNotificationPreferenceRepository(db),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new FixedClock(NOW),
      auditRecorder: faultyAuditRecorder,
    });

    await expect(
      setNotificationPreference({ auth, alertType: 'RIESGO_CRITICO', channel: 'EMAIL', enabled: false }),
    ).rejects.toThrow('audit bridge boom (post-write)');

    const prefCount = await db.collection('notification_preferences').countDocuments({});
    const auditCount = await db.collection('audit_logs').countDocuments({});
    expect(prefCount).toBe(0);
    expect(auditCount).toBe(0);
  });
});
