import { oid } from '../../../../support/oid.js';
import { createRevokeAdminKeyUseCase } from '../../../../../src/modules/identity-access/application/admin/RevokeAdminKey.js';
import { AdminOrganization } from '../../../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { InMemoryAdminOrganizationRepository } from '../../../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { Session } from '../../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CREATED_AT = fromDate(new Date('2025-12-31T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: oid('admin-caller'), organizationId: null, isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('o1'), isPlatformAdmin: false });

function buildHarness() {
  const admins = new InMemoryAdminOrganizationRepository();
  const sessions = new InMemorySessionRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const revokeAdminKey = createRevokeAdminKeyUseCase({
    admins,
    sessions,
    unitOfWork,
    clock: new FixedClock(NOW),
    auditRecorder,
  });
  return { admins, sessions, unitOfWork, auditRecorder, revokeAdminKey };
}

async function seedAdminWithActiveKey(admins: InMemoryAdminOrganizationRepository, id = oid('admin-1')) {
  const admin = AdminOrganization.create({
    id: createAdminOrganizationId(id),
    email: createEmail('root@platform.internal'),
    keys: [
      createAdminKey({
        keyId: createAdminKeyId(oid('key-1')),
        publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
        status: 'ACTIVE',
        encryptedPrivateKey: 'ciphertext',
        createdAt: CREATED_AT,
      }),
    ],
    now: CREATED_AT,
  });
  await admins.save(admin);
  return admin;
}

async function seedSessionForAdmin(sessions: InMemorySessionRepository, adminId: string) {
  const session = Session.create({
    id: createSessionId(oid('session-1')),
    familyId: createFamilyId(oid('family-1')),
    userId: adminId,
    organizationId: null,
    actorType: 'PLATFORM_ADMIN',
    tokenHash: 'token-hash',
    refreshTokenHash: null,
    expiresAt: fromDate(new Date('2026-02-01T00:00:00.000Z')),
    refreshExpiresAt: null,
    familyExpiresAt: fromDate(new Date('2026-03-01T00:00:00.000Z')),
    now: CREATED_AT,
  });
  await sessions.save(session);
  return session;
}

describe('createRevokeAdminKeyUseCase', () => {
  it('marks the key REVOKED (terminal)', async () => {
    const { admins, revokeAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    const revoked = await revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') });

    const key = revoked.findKey(createAdminKeyId(oid('key-1')));
    expect(key?.status).toBe('REVOKED');
    expect(key?.revokedAt).toBe(NOW);
    expect(revoked.activeKey()).toBeNull();
  });

  it('persists the revoked aggregate', async () => {
    const { admins, revokeAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') });

    const reloaded = await admins.findById(admin.id);
    expect(reloaded?.findKey(createAdminKeyId(oid('key-1')))?.status).toBe('REVOKED');
  });

  it('rejects revoking an already-REVOKED key (double revoke)', async () => {
    const { admins, revokeAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);
    await revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') });

    await expect(
      revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
  });

  it('cascades: revokes every existing session for this admin (D40)', async () => {
    const { admins, sessions, revokeAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);
    await seedSessionForAdmin(sessions, admin.id);

    await revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') });

    const reloadedSession = await sessions.findByTokenHash('token-hash');
    expect(reloadedSession?.deletedAt).toBe(NOW);
  });

  it('records a PLATFORM_ADMIN_KEY_REVOKED audit event inside the transaction', async () => {
    const { admins, auditRecorder, revokeAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('PLATFORM_ADMIN_KEY_REVOKED');
    expect(calls[0].tx).toBeDefined();
  });

  it('rejects an unknown adminOrganizationId with ADMIN_ORGANIZATION_NOT_FOUND', async () => {
    const { revokeAdminKey } = buildHarness();

    await expect(
      revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: oid('missing-admin'), keyId: oid('key-1') }),
    ).rejects.toMatchObject({ code: 'ADMIN_ORGANIZATION_NOT_FOUND' });
  });

  it('rejects an unknown keyId with INVARIANT_VIOLATION (aggregate guard)', async () => {
    const { admins, revokeAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await expect(
      revokeAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('nonexistent') }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
  });

  it('rejects a non-platform-admin caller with FORBIDDEN_CROSS_TENANT', async () => {
    const { admins, revokeAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await expect(
      revokeAdminKey({ auth: REGULAR_USER, adminOrganizationId: admin.id, keyId: oid('key-1') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
