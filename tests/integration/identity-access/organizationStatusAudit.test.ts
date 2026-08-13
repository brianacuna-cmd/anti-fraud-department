import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoSessionRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoSessionRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from '../../../src/composition/auditRecorderAdapter.js';
import { createTransitionOrganizationStatusUseCase } from '../../../src/modules/identity-access/application/TransitionOrganizationStatus.js';
import type { AuditEvent, AuditRecorder } from '../../../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/identity-access/domain/ports/UnitOfWork.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';
import { buildSession } from '../../helpers/identity-access/buildSession.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: oid('admin-1'), organizationId: oid('o0'), isPlatformAdmin: true });

/** Throws on the Nth call to `record`, letting earlier calls hit real Mongo — proves partial-write rollback. */
function failOnNthCall(recorder: AuditRecorder, failAt: number): AuditRecorder {
  let calls = 0;
  return {
    async record(event: AuditEvent, tx?: Transaction): Promise<void> {
      calls += 1;
      if (calls === failAt) {
        throw new Error('induced audit failure mid-transaction');
      }
      await recorder.record(event, tx);
    },
  };
}

describe('TransitionOrganizationStatus audit atomicity (integration, real replica-set Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let organizations: MongoOrganizationRepository;
  let sessions: MongoSessionRepository;
  let baseAuditRecorder: AuditRecorder;

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
    organizations = new MongoOrganizationRepository(db);
    sessions = new MongoSessionRepository(db);
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId });
    baseAuditRecorder = createAuditRecorderAdapter(recordAuditLog);
  });

  afterEach(async () => {
    await db.collection('organizations').deleteMany({});
    await db.collection('sessions').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
  });

  async function seedOrganization(id = oid('org-1')): Promise<void> {
    await organizations.save(
      Organization.create({ id: createOrganizationId(id), name: 'Acme', slug: createSlug(`acme-${id}`), now: NOW }),
    );
  }

  async function seedSession(id: string, organizationId: string): Promise<void> {
    await sessions.save(
      buildSession({
        id,
        userId: oid('org-user-1'),
        organizationId,
        now: NOW,
        expiresAt: NOW,
      }),
    );
  }

  function buildUseCase(auditRecorder: AuditRecorder) {
    return createTransitionOrganizationStatusUseCase({
      organizations,
      sessions,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      auditRecorder,
    });
  }

  it('commits exactly one ORGANIZATION_STATUS_CHANGED audit row atomically with a non-CANCELLED transition', async () => {
    await seedOrganization(oid('org-1'));
    const transitionOrganizationStatus = buildUseCase(baseAuditRecorder);

    await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'SUSPENDED' });

    const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
    expect(persisted?.status).toBe('SUSPENDED');
    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('ORGANIZATION_STATUS_CHANGED');
  });

  it('rolls back the status change AND persists NO audit row when the audit write fails mid-transaction', async () => {
    await seedOrganization(oid('org-1'));
    const failingRecorder = failOnNthCall(baseAuditRecorder, 1);
    const transitionOrganizationStatus = buildUseCase(failingRecorder);

    await expect(
      transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'SUSPENDED' }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
    expect(persisted?.status).toBe('ACTIVE');
    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
  });

  it('on CANCELLED: commits the status change, the session revocation, AND both audit rows atomically', async () => {
    await seedOrganization(oid('org-1'));
    await seedSession(oid('session-1'), oid('org-1'));
    await seedSession(oid('session-2'), oid('org-1'));
    const transitionOrganizationStatus = buildUseCase(baseAuditRecorder);

    await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'CANCELLED' });

    const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
    expect(persisted?.status).toBe('CANCELLED');
    const revoked1 = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    const revoked2 = await sessions.findByTokenHash(`token-hash-${oid('session-2')}`);
    expect(revoked1?.deletedAt).not.toBeNull();
    expect(revoked2?.deletedAt).not.toBeNull();
    const auditRows = await db.collection('audit_logs').find({}).sort({ action: 1 }).toArray();
    expect(auditRows).toHaveLength(2);
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['ORGANIZATION_STATUS_CHANGED', 'ORGANIZATION_SESSIONS_REVOKED']),
    );
  });

  it('on CANCELLED: when the SECOND audit write fails, rolls back the status change, the session revocation, AND the already-inserted first audit row', async () => {
    await seedOrganization(oid('org-1'));
    await seedSession(oid('session-1'), oid('org-1'));
    const failingRecorder = failOnNthCall(baseAuditRecorder, 2);
    const transitionOrganizationStatus = buildUseCase(failingRecorder);

    await expect(
      transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), next: 'CANCELLED' }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
    expect(persisted?.status).toBe('ACTIVE');
    const revoked1 = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    expect(revoked1?.deletedAt).toBeNull();
    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
  });
});
