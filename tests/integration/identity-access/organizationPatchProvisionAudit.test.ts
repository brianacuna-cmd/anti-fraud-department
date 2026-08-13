import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoAdminOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoAdminOrganizationRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { AesGcmSecretCipher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from '../../../src/composition/auditRecorderAdapter.js';
import { createPatchOrganizationIdentityUseCase } from '../../../src/modules/identity-access/application/PatchOrganizationIdentity.js';
import { createProvisionAdminOrganizationUseCase } from '../../../src/modules/identity-access/application/admin/ProvisionAdminOrganization.js';
import { FakeAdminKeyPairGenerator } from '../../helpers/identity-access/FakeAdminKeyPairGenerator.js';
import type { AuditEvent, AuditRecorder } from '../../../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/identity-access/domain/ports/UnitOfWork.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createAdminOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: 'admin-1', organizationId: null, isPlatformAdmin: true });

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

describe('Organization Patch/Provision audit atomicity (integration, real replica-set Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let organizations: MongoOrganizationRepository;
  let admins: MongoAdminOrganizationRepository;
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
    admins = new MongoAdminOrganizationRepository(db);
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId });
    baseAuditRecorder = createAuditRecorderAdapter(recordAuditLog);
  });

  afterEach(async () => {
    await db.collection('Organizations').deleteMany({});
    await db.collection('adminOrganizations').deleteMany({});
    await db.collection('AuditLogs').deleteMany({});
  });

  async function seedOrganization(id = oid('org-1')): Promise<void> {
    await organizations.save(
      Organization.create({ id: createOrganizationId(id), name: 'Acme', slug: createSlug(`acme-${id}`), now: NOW }),
    );
  }

  function buildPatch(auditRecorder: AuditRecorder) {
    return createPatchOrganizationIdentityUseCase({
      organizations,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      auditRecorder,
    });
  }

  function buildProvision(auditRecorder: AuditRecorder) {
    let orgSeq = 0;
    let keySeq = 0;
    return createProvisionAdminOrganizationUseCase({
      admins,
      keyPairs: new FakeAdminKeyPairGenerator(),
      cipher: new AesGcmSecretCipher('provision-integration-secret', 1),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      generateAdminOrganizationId: () => {
        orgSeq += 1;
        return createAdminOrganizationId(oid(`admin-org-${orgSeq}`));
      },
      generateAdminKeyId: () => {
        keySeq += 1;
        return createAdminKeyId(oid(`admin-key-${keySeq}`));
      },
      auditRecorder,
    });
  }

  describe('PatchOrganizationIdentity', () => {
    it('commits exactly one ORGANIZATION_IDENTITY_UPDATED audit row atomically with the patch', async () => {
      await seedOrganization(oid('org-1'));
      const patch = buildPatch(baseAuditRecorder);

      await patch({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), name: 'Acme Renamed' });

      const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
      expect(persisted?.name).toBe('Acme Renamed');
      const auditRows = await db.collection('AuditLogs').find({}).toArray();
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.Action).toBe('ORGANIZATION_IDENTITY_UPDATED');
    });

    it('rolls back the patch AND persists NO audit row when the audit write fails', async () => {
      await seedOrganization(oid('org-1'));
      const patch = buildPatch(failOnNthCall(baseAuditRecorder, 1));

      await expect(
        patch({ auth: PLATFORM_ADMIN, organizationId: oid('org-1'), name: 'Acme Renamed' }),
      ).rejects.toThrow('induced audit failure mid-transaction');

      const persisted = await organizations.findById(createOrganizationId(oid('org-1')));
      expect(persisted?.name).toBe('Acme');
      const auditRows = await db.collection('AuditLogs').find({}).toArray();
      expect(auditRows).toHaveLength(0);
    });
  });

  describe('ProvisionAdminOrganization', () => {
    it('commits the AdminOrganization AND exactly one PLATFORM_ADMIN_PROVISIONED audit row atomically', async () => {
      const provision = buildProvision(baseAuditRecorder);

      await provision({ auth: PLATFORM_ADMIN, email: 'root@platform.internal' });

      const adminRows = await db.collection('adminOrganizations').find({}).toArray();
      expect(adminRows).toHaveLength(1);
      const auditRows = await db.collection('AuditLogs').find({}).toArray();
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.Action).toBe('PLATFORM_ADMIN_PROVISIONED');
    });

    it('rolls back the AdminOrganization AND persists NO audit row when the audit write fails', async () => {
      const provision = buildProvision(failOnNthCall(baseAuditRecorder, 1));

      await expect(
        provision({ auth: PLATFORM_ADMIN, email: 'root@platform.internal' }),
      ).rejects.toThrow('induced audit failure mid-transaction');

      const adminRows = await db.collection('adminOrganizations').find({}).toArray();
      expect(adminRows).toHaveLength(0);
      const auditRows = await db.collection('AuditLogs').find({}).toArray();
      expect(auditRows).toHaveLength(0);
    });
  });
});
