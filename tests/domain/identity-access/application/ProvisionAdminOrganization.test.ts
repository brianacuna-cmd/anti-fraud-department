import { oid } from '../../../support/oid.js';
import { createProvisionAdminOrganizationUseCase } from '../../../../src/modules/identity-access/application/admin/ProvisionAdminOrganization.js';
import { InMemoryAdminOrganizationRepository } from '../../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakeAdminKeyPairGenerator } from '../../../helpers/identity-access/FakeAdminKeyPairGenerator.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAdminOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: null,
  isPlatformAdmin: true,
  ipAddress: '203.0.113.10',
});
const REGULAR_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('o1'), isPlatformAdmin: false });

function buildUseCase() {
  const admins = new InMemoryAdminOrganizationRepository();
  const keyPairs = new FakeAdminKeyPairGenerator();
  const cipher = new AesGcmSecretCipher('provision-test-secret', 1);
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const clock = new FixedClock(NOW);
  let nextOrgIdSeq = 0;
  let nextKeyIdSeq = 0;
  const provisionAdminOrganization = createProvisionAdminOrganizationUseCase({
    admins,
    keyPairs,
    cipher,
    unitOfWork,
    clock,
    generateAdminOrganizationId: () => {
      nextOrgIdSeq += 1;
      return createAdminOrganizationId(oid(`admin-org-${nextOrgIdSeq}`));
    },
    generateAdminKeyId: () => {
      nextKeyIdSeq += 1;
      return createAdminKeyId(oid(`admin-key-${nextKeyIdSeq}`));
    },
    auditRecorder,
  });
  return { provisionAdminOrganization, admins, cipher, unitOfWork, auditRecorder };
}

describe('createProvisionAdminOrganizationUseCase', () => {
  it('provisions a new AdminOrganization with one ACTIVE key for a platform-admin', async () => {
    const { provisionAdminOrganization, admins } = buildUseCase();

    const admin = await provisionAdminOrganization({ auth: PLATFORM_ADMIN, email: 'root@platform.internal' });

    expect(admin.email).toBe('root@platform.internal');
    expect(admin.keys).toHaveLength(1);
    expect(admin.keys[0]?.status).toBe('ACTIVE');
    const persisted = await admins.findById(admin.id);
    expect(persisted?.id).toBe(admin.id);
  });

  it('stores the public key cleartext and the private key only as SecretCipher ciphertext', async () => {
    const { provisionAdminOrganization, cipher } = buildUseCase();

    const admin = await provisionAdminOrganization({ auth: PLATFORM_ADMIN, email: 'root@platform.internal' });

    const key = admin.keys[0]!;
    expect(key.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(key.encryptedPrivateKey).not.toBeNull();
    expect(key.encryptedPrivateKey).not.toContain('BEGIN PRIVATE KEY');
    const decrypted = cipher.decrypt(key.encryptedPrivateKey!);
    expect(decrypted).toContain('BEGIN PRIVATE KEY');
  });

  it('rejects a non-platform-admin actor with FORBIDDEN_CROSS_TENANT', async () => {
    const { provisionAdminOrganization, unitOfWork } = buildUseCase();

    expect.assertions(3);
    try {
      await provisionAdminOrganization({ auth: REGULAR_USER, email: 'root@platform.internal' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(unitOfWork.transactionCount).toBe(0);
  });

  it('emits exactly one PLATFORM_ADMIN_PROVISIONED audit event with no organizationId, threaded with the tx', async () => {
    const { provisionAdminOrganization, auditRecorder } = buildUseCase();

    const admin = await provisionAdminOrganization({ auth: PLATFORM_ADMIN, email: 'root@platform.internal' });

    expect(auditRecorder.all()).toHaveLength(1);
    const [event] = auditRecorder.all();
    expect(event).toMatchObject({
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
      actorId: oid('admin-1'),
      action: 'PLATFORM_ADMIN_PROVISIONED',
      resource: 'adminOrganizations',
      resourceId: admin.id,
      detail: { email: 'root@platform.internal' },
      ipAddress: '203.0.113.10',
    });
    expect(auditRecorder.calls()[0]?.tx).toBeDefined();
  });
});
