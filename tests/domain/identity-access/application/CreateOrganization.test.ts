import { oid } from '../../../support/oid.js';
import { createCreateOrganizationUseCase } from '../../../../src/modules/identity-access/application/CreateOrganization.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
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
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const clock = new FixedClock(NOW);
  let nextId = 0;
  const createOrganization = createCreateOrganizationUseCase({
    organizations,
    unitOfWork,
    clock,
    generateId: () => {
      nextId += 1;
      return createOrganizationId(oid(`org-${nextId}`));
    },
    auditRecorder,
  });
  return { createOrganization, organizations, unitOfWork, auditRecorder };
}

describe('createCreateOrganizationUseCase', () => {
  it('creates and persists a new ACTIVE organization for a platform-admin', async () => {
    const { createOrganization, organizations } = buildUseCase();

    const organization = await createOrganization({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
    });

    expect(organization.status).toBe('ACTIVE');
    expect(organization.slug).toBe('acme-corp');
    const persisted = await organizations.findBySlug(createSlug('acme-corp'));
    expect(persisted?.name).toBe('Acme Corp');
  });

  it('rejects a duplicate slug with ORGANIZATION_SLUG_TAKEN', async () => {
    const { createOrganization } = buildUseCase();
    await createOrganization({ auth: PLATFORM_ADMIN, name: 'Acme Corp', slug: 'acme-corp' });

    expect.assertions(2);
    try {
      await createOrganization({ auth: PLATFORM_ADMIN, name: 'Acme Corp 2', slug: 'acme-corp' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_SLUG_TAKEN');
    }
  });

  it('rejects a non-platform-admin actor with FORBIDDEN_CROSS_TENANT', async () => {
    const { createOrganization, unitOfWork } = buildUseCase();

    expect.assertions(3);
    try {
      await createOrganization({ auth: REGULAR_USER, name: 'Acme Corp', slug: 'acme-corp' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(unitOfWork.transactionCount).toBe(0);
  });

  it('emits exactly one ORGANIZATION_CREATED audit event, threaded with the tx', async () => {
    const { createOrganization, auditRecorder } = buildUseCase();

    const organization = await createOrganization({ auth: PLATFORM_ADMIN, name: 'Acme Corp', slug: 'acme-corp' });

    expect(auditRecorder.all()).toHaveLength(1);
    const [event] = auditRecorder.all();
    expect(event).toMatchObject({
      organizationId: organization.id,
      actorType: 'PLATFORM_ADMIN',
      actorId: oid('u1'),
      action: 'ORGANIZATION_CREATED',
      resource: 'organizations',
      resourceId: organization.id,
      detail: { name: 'Acme Corp', slug: 'acme-corp' },
      ipAddress: '203.0.113.10',
    });
    expect(auditRecorder.calls()[0]?.tx).toBeDefined();
  });
});
