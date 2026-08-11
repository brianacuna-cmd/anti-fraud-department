import { createDisableMfaUseCase } from '../../../../src/modules/identity-access/application/DisableMfa.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DISABLED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const AUTH = createAuthContext({ userId: 'user-1', organizationId: 'org-1', isPlatformAdmin: false });

async function seedEnabledUser(userRepositoryFactory: InMemoryUserRepositoryFactory): Promise<void> {
  const org = createOrganizationId('org-1');
  const user = User.create({
    id: createUserId('user-1'),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  })
    .startMfaEnrollment('encrypted-secret', CREATED_AT)
    .confirmMfaEnrollment(CREATED_AT);
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  unitOfWork: InMemoryUnitOfWork,
  auditRecorder: InMemoryAuditRecorder = new InMemoryAuditRecorder(),
) {
  return createDisableMfaUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock: new FixedClock(DISABLED_AT),
    auditRecorder,
  });
}

describe('createDisableMfaUseCase', () => {
  it('disables MFA inside a transaction and emits exactly one MFA_DISABLED audit event', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedEnabledUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const disableMfa = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    const user = await disableMfa({ auth: AUTH });

    expect(user.mfa).toEqual({ secret: null, enabled: false, recoveryCodes: [] });
    expect(unitOfWork.transactionCount).toBe(1);
    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('MFA_DISABLED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe('user-1');
  });

  it('rejects an unknown authenticated user with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const disableMfa = buildUseCase(userRepositoryFactory, unitOfWork);

    await expect(disableMfa({ auth: AUTH })).rejects.toBeInstanceOf(IdentityAccessError);
  });
});
