import { oid } from '../../support/oid.js';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from '../../../src/composition/auditRecorderAdapter.js';
import { createCreateOrganizationUseCase } from '../../../src/modules/identity-access/application/CreateOrganization.js';
import type { AuditEvent, AuditRecorder } from '../../../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/identity-access/domain/ports/UnitOfWork.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { generateOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';

jest.setTimeout(120_000);

const PLATFORM_ADMIN = createAuthContext({ userId: oid('admin-1'), organizationId: oid('o0'), isPlatformAdmin: true });

function alwaysFailingRecorder(): AuditRecorder {
  return {
    async record(_event: AuditEvent, _tx?: Transaction): Promise<void> {
      throw new Error('induced audit failure mid-transaction');
    },
  };
}

/**
 * CreateOrganization had NO transaction at all before audit-logs-foundation
 * Phase 4 (design's flagged tx-threading trap). This proves the retrofit
 * genuinely wraps the write in a real Mongo transaction — not just typed to
 * accept one — by showing a failing audit write rolls back the organization
 * write too.
 */
describe('CreateOrganization audit atomicity (integration, real replica-set Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let organizations: MongoOrganizationRepository;

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
  });

  afterEach(async () => {
    await db.collection('organizations').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
  });

  function buildUseCase(auditRecorder: AuditRecorder) {
    return createCreateOrganizationUseCase({
      organizations,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      generateId: generateOrganizationId,
      auditRecorder,
    });
  }

  it('commits both the organization write and exactly one ORGANIZATION_CREATED audit row', async () => {
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId });
    const createOrganization = buildUseCase(createAuditRecorderAdapter(recordAuditLog));

    const organization = await createOrganization({ auth: PLATFORM_ADMIN, name: 'Acme Corp', slug: 'acme-corp' });

    const persisted = await organizations.findBySlug(createSlug('acme-corp'));
    expect(persisted?.id).toBe(organization.id);
    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('ORGANIZATION_CREATED');
  });

  it('rolls back the organization write when the audit write fails mid-transaction (proves the write is truly inside the tx)', async () => {
    const createOrganization = buildUseCase(alwaysFailingRecorder());

    await expect(
      createOrganization({ auth: PLATFORM_ADMIN, name: 'Acme Corp', slug: 'acme-corp' }),
    ).rejects.toThrow('induced audit failure mid-transaction');

    const persisted = await organizations.findBySlug(createSlug('acme-corp'));
    expect(persisted).toBeNull();
    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows).toHaveLength(0);
  });
});
