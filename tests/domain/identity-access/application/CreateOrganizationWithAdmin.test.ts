import { oid } from '../../../support/oid.js';
import { createCreateOrganizationWithAdminUseCase } from '../../../../src/modules/identity-access/application/CreateOrganizationWithAdmin.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakePasswordHasher } from '../../../helpers/identity-access/FakePasswordHasher.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({
  userId: oid('u1'),
  organizationId: oid('o0'),
  isPlatformAdmin: true,
  ipAddress: '203.0.113.10',
});
const REGULAR_USER = createAuthContext({ userId: oid('u2'), organizationId: oid('o1'), isPlatformAdmin: false });

function buildUseCase() {
  const organizations = new InMemoryOrganizationRepository();
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const passwordHasher = new FakePasswordHasher();
  let nextOrgId = 0;
  let nextUserId = 0;
  const createOrganizationWithAdmin = createCreateOrganizationWithAdminUseCase({
    organizations,
    userRepositoryFactory,
    passwordHasher,
    unitOfWork,
    clock: new FixedClock(NOW),
    generateOrganizationId: () => {
      nextOrgId += 1;
      return createOrganizationId(oid(`org-${nextOrgId}`));
    },
    generateUserId: () => {
      nextUserId += 1;
      return createUserId(oid(`user-${nextUserId}`));
    },
    auditRecorder,
  });
  return { createOrganizationWithAdmin, organizations, userRepositoryFactory, unitOfWork, auditRecorder };
}

describe('createCreateOrganizationWithAdminUseCase', () => {
  it('atomically creates the organization and its first admin user', async () => {
    const { createOrganizationWithAdmin, organizations, userRepositoryFactory, unitOfWork } = buildUseCase();

    const organization = await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'admin@acme.com',
      adminPassword: 'Sup3rSecret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    expect(organization.status).toBe('ACTIVE');
    expect(unitOfWork.transactionCount).toBe(1);
    const persistedOrg = await organizations.findBySlug(createSlug('acme-corp'));
    expect(persistedOrg?.id).toBe(organization.id);
    const adminUser = await userRepositoryFactory.forTenant(organization.id).findByEmail(createEmail('admin@acme.com'));
    expect(adminUser?.firstName).toBe('Root');
    expect(adminUser?.organizationId).toBe(organization.id);
  });

  it('persists the bootstrap admin user with roleId=ADMIN (user-roles PR-1b, sole ADMIN-on-User exception)', async () => {
    const { createOrganizationWithAdmin, userRepositoryFactory } = buildUseCase();

    const organization = await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'admin@acme.com',
      adminPassword: 'Sup3rSecret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    const adminUser = await userRepositoryFactory.forTenant(organization.id).findByEmail(createEmail('admin@acme.com'));
    expect(adminUser?.roleId).toBe('ADMIN');
  });

  it('rejects a duplicate slug with ORGANIZATION_SLUG_TAKEN, creating no admin user', async () => {
    const { createOrganizationWithAdmin, userRepositoryFactory } = buildUseCase();
    await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'admin@acme.com',
      adminPassword: 'Sup3rSecret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    expect.assertions(3);
    try {
      await createOrganizationWithAdmin({
        auth: PLATFORM_ADMIN,
        name: 'Acme Corp 2',
        slug: 'acme-corp',
        adminEmail: 'other-admin@acme.com',
        adminPassword: 'Sup3rSecret',
        adminFirstName: 'Other',
        adminLastName: 'Admin',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_SLUG_TAKEN');
    }
    const secondOrg = await userRepositoryFactory.forTenant(createOrganizationId(oid('org-2'))).findByEmail(
      createEmail('other-admin@acme.com'),
    );
    expect(secondOrg).toBeNull();
  });

  it('rejects a duplicate admin email across ANY organization with USER_EMAIL_TAKEN, creating no organization', async () => {
    const { createOrganizationWithAdmin, organizations } = buildUseCase();
    await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'shared-admin@example.com',
      adminPassword: 'Sup3rSecret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    expect.assertions(3);
    try {
      await createOrganizationWithAdmin({
        auth: PLATFORM_ADMIN,
        name: 'Globex',
        slug: 'globex',
        adminEmail: 'shared-admin@example.com',
        adminPassword: 'Sup3rSecret',
        adminFirstName: 'New',
        adminLastName: 'Admin',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_EMAIL_TAKEN');
    }
    const globex = await organizations.findBySlug(createSlug('globex'));
    expect(globex).toBeNull();
  });

  it('rejects a non-platform-admin caller with FORBIDDEN_CROSS_TENANT before touching any repository', async () => {
    const { createOrganizationWithAdmin, unitOfWork } = buildUseCase();

    expect.assertions(3);
    try {
      await createOrganizationWithAdmin({
        auth: REGULAR_USER,
        name: 'Acme Corp',
        slug: 'acme-corp',
        adminEmail: 'admin@acme.com',
        adminPassword: 'Sup3rSecret',
        adminFirstName: 'Root',
        adminLastName: 'Admin',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(unitOfWork.transactionCount).toBe(0);
  });

  it('binds the admin user repository to the NEW organization, not the caller\'s own organization', async () => {
    const { createOrganizationWithAdmin, userRepositoryFactory } = buildUseCase();

    const organization = await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'admin@acme.com',
      adminPassword: 'Sup3rSecret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    const callerOrgUsers = await userRepositoryFactory.forTenant(createOrganizationId(oid('o0'))).list(10);
    expect(callerOrgUsers.items).toHaveLength(0);
    const newOrgUsers = await userRepositoryFactory.forTenant(organization.id).list(10);
    expect(newOrgUsers.items).toHaveLength(1);
  });

  it('emits exactly one ORGANIZATION_CREATED audit event, threaded with the tx', async () => {
    const { createOrganizationWithAdmin, auditRecorder } = buildUseCase();

    const organization = await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'admin@acme.com',
      adminPassword: 'Sup3rSecret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    expect(auditRecorder.all()).toHaveLength(1);
    const [event] = auditRecorder.all();
    expect(event).toMatchObject({
      organizationId: organization.id,
      actorType: 'PLATFORM_ADMIN',
      actorId: oid('u1'),
      action: 'ORGANIZATION_CREATED',
      resource: 'organizations',
      resourceId: organization.id,
      ipAddress: '203.0.113.10',
    });
    expect(auditRecorder.calls()[0]?.tx).toBeDefined();
  });

  it('rejects a weak admin password with WEAK_PASSWORD before opening the transaction', async () => {
    const { createOrganizationWithAdmin, organizations, unitOfWork } = buildUseCase();

    await expect(
      createOrganizationWithAdmin({
        auth: PLATFORM_ADMIN,
        name: 'Acme Corp',
        slug: 'acme-corp',
        adminEmail: 'admin@acme.com',
        adminPassword: '123',
        adminFirstName: 'Root',
        adminLastName: 'Admin',
      }),
    ).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });

    expect(unitOfWork.transactionCount).toBe(0);
    expect(await organizations.findBySlug(createSlug('acme-corp'))).toBeNull();
  });
});
