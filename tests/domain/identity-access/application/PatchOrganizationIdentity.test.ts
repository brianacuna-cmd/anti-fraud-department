import { createPatchOrganizationIdentityUseCase } from '../../../../src/modules/identity-access/application/PatchOrganizationIdentity.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PATCHED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({
  userId: 'u1',
  organizationId: 'o0',
  isPlatformAdmin: true,
  ipAddress: '203.0.113.10',
});

async function seedOrganization(organizations: InMemoryOrganizationRepository): Promise<void> {
  await organizations.save(
    Organization.create({
      id: createOrganizationId('org-1'),
      name: 'Acme',
      slug: createSlug('acme'),
      now: CREATED_AT,
    }),
  );
}

function buildUseCase(organizations: InMemoryOrganizationRepository) {
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const patchOrganizationIdentity = createPatchOrganizationIdentityUseCase({
    organizations,
    unitOfWork,
    clock: new FixedClock(PATCHED_AT),
    auditRecorder,
  });
  return { patchOrganizationIdentity, unitOfWork, auditRecorder };
}

describe('createPatchOrganizationIdentityUseCase', () => {
  it('updates name and domain while leaving slug unchanged', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const { patchOrganizationIdentity } = buildUseCase(organizations);

    const updated = await patchOrganizationIdentity({
      auth: PLATFORM_ADMIN,
      organizationId: 'org-1',
      name: 'Acme Corp',
      domain: 'acme.com',
    });

    expect(updated.name).toBe('Acme Corp');
    expect(updated.domain).toBe('acme.com');
    expect(updated.slug).toBe('acme');
    expect(updated.updatedAt).toBe(PATCHED_AT);
  });

  it('rejects an unknown id with ORGANIZATION_NOT_FOUND', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const { patchOrganizationIdentity } = buildUseCase(organizations);

    expect.assertions(2);
    try {
      await patchOrganizationIdentity({ auth: PLATFORM_ADMIN, organizationId: 'missing', name: 'X' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_NOT_FOUND');
    }
  });

  it('emits exactly one ORGANIZATION_IDENTITY_UPDATED audit event, threaded with the tx', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const { patchOrganizationIdentity, auditRecorder } = buildUseCase(organizations);

    await patchOrganizationIdentity({
      auth: PLATFORM_ADMIN,
      organizationId: 'org-1',
      name: 'Acme Corp',
      domain: 'acme.com',
    });

    expect(auditRecorder.all()).toHaveLength(1);
    const [event] = auditRecorder.all();
    expect(event).toMatchObject({
      organizationId: 'org-1',
      actorType: 'PLATFORM_ADMIN',
      actorId: 'u1',
      action: 'ORGANIZATION_IDENTITY_UPDATED',
      resource: 'organizations',
      resourceId: 'org-1',
      detail: { name: 'Acme Corp', domain: 'acme.com' },
      ipAddress: '203.0.113.10',
    });
    expect(auditRecorder.calls()[0]?.tx).toBeDefined();
  });
});
