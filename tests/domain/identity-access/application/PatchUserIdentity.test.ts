import { createPatchUserIdentityUseCase } from '../../../../src/modules/identity-access/application/PatchUserIdentity.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PATCHED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: 'u1', organizationId: 'org-1', isPlatformAdmin: false });
const ORG_2_USER = createAuthContext({ userId: 'u2', organizationId: 'org-2', isPlatformAdmin: false });

async function seedUser(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  id: string,
  email: string,
  organizationId = 'org-1',
): Promise<void> {
  const org = createOrganizationId(organizationId);
  const user = User.create({
    id: createUserId(id),
    organizationId: org,
    email: createEmail(email),
    credential: createPasswordCredential('hash'),
    firstName: 'First',
    lastName: 'Last',
    now: CREATED_AT,
  });
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(userRepositoryFactory: InMemoryUserRepositoryFactory) {
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const patchUserIdentity = createPatchUserIdentityUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock: new FixedClock(PATCHED_AT),
    auditRecorder,
  });
  return { patchUserIdentity, unitOfWork, auditRecorder };
}

describe('createPatchUserIdentityUseCase', () => {
  it('updates only the given identity fields', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'alice@example.com');
    const { patchUserIdentity } = buildUseCase(userRepositoryFactory);

    const patched = await patchUserIdentity({ auth: ORG_1_USER, userId: 'user-1', firstName: 'Alicia' });

    expect(patched.firstName).toBe('Alicia');
    expect(patched.lastName).toBe('Last');
    expect(patched.updatedAt).toBe(PATCHED_AT);
  });

  it('rejects an email conflicting with another same-org user with USER_EMAIL_TAKEN', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'alice@example.com');
    await seedUser(userRepositoryFactory, 'user-2', 'bob@example.com');
    const { patchUserIdentity } = buildUseCase(userRepositoryFactory);

    expect.assertions(2);
    try {
      await patchUserIdentity({ auth: ORG_1_USER, userId: 'user-2', email: 'alice@example.com' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_EMAIL_TAKEN');
    }
  });

  it('allows patching a user\'s own email to the same value without USER_EMAIL_TAKEN', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'alice@example.com');
    const { patchUserIdentity } = buildUseCase(userRepositoryFactory);

    const patched = await patchUserIdentity({ auth: ORG_1_USER, userId: 'user-1', email: 'alice@example.com' });

    expect(patched.email).toBe('alice@example.com');
  });

  it('rejects a cross-tenant patch with USER_NOT_FOUND, leaving the target unchanged', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'alice@example.com', 'org-1');
    const { patchUserIdentity } = buildUseCase(userRepositoryFactory);

    expect.assertions(3);
    try {
      await patchUserIdentity({ auth: ORG_2_USER, userId: 'user-1', firstName: 'Hacked' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
    const unchanged = await userRepositoryFactory.forTenant(createOrganizationId('org-1')).findById(createUserId('user-1'));
    expect(unchanged?.firstName).toBe('First');
  });

  it('emits exactly one USER_IDENTITY_UPDATED audit event inside the transaction', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'alice@example.com');
    const { patchUserIdentity, auditRecorder } = buildUseCase(userRepositoryFactory);

    await patchUserIdentity({ auth: ORG_1_USER, userId: 'user-1', firstName: 'Alicia' });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('USER_IDENTITY_UPDATED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe('user-1');
  });

  it('records no audit event when the patch fails (email conflict)', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'alice@example.com');
    await seedUser(userRepositoryFactory, 'user-2', 'bob@example.com');
    const { patchUserIdentity, auditRecorder } = buildUseCase(userRepositoryFactory);

    await expect(
      patchUserIdentity({ auth: ORG_1_USER, userId: 'user-2', email: 'alice@example.com' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    expect(auditRecorder.all()).toHaveLength(0);
  });
});
