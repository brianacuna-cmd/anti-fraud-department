import { createDeleteUserUseCase } from '../../../../src/modules/identity-access/application/DeleteUser.js';
import { createTransitionUserStatusUseCase } from '../../../../src/modules/identity-access/application/TransitionUserStatus.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { Session } from '../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { createSessionId } from '../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DELETED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'org-1', actorType: 'ORGANIZATION' });

async function seedUser(userRepositoryFactory: InMemoryUserRepositoryFactory, id = 'user-1'): Promise<void> {
  const org = createOrganizationId('org-1');
  await userRepositoryFactory.forTenant(org).save(
    User.create({
      id: createUserId(id),
      organizationId: org,
      email: createEmail('alice@example.com'),
      credential: createPasswordCredential('hash'),
      firstName: 'Alice',
      lastName: 'Smith',
      roleId: createRoleId('ANALYST'),
      now: CREATED_AT,
    }),
  );
}

function buildUseCases(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  sessions: InMemorySessionRepository = new InMemorySessionRepository(),
  auditRecorder: InMemoryAuditRecorder = new InMemoryAuditRecorder(),
) {
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(DELETED_AT);
  const transitionUserStatus = createTransitionUserStatusUseCase({
    userRepositoryFactory,
    sessions,
    unitOfWork,
    clock,
    auditRecorder,
  });
  const deleteUser = createDeleteUserUseCase({ transitionUserStatus });
  return { transitionUserStatus, deleteUser };
}

function buildSession(id: string): Session {
  return Session.create({
    id: createSessionId(id),
    userId: 'user-1',
    organizationId: createOrganizationId('org-1'),
    actorType: 'USER',
    tokenHash: `token-hash-${id}`,
    refreshTokenHash: `refresh-hash-${id}`,
    expiresAt: DELETED_AT,
    refreshExpiresAt: DELETED_AT,
    familyId: createFamilyId('family-1'),
    familyExpiresAt: DELETED_AT,
    now: CREATED_AT,
  });
}

describe('createDeleteUserUseCase', () => {
  it('transitions the user to DISABLED', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const { deleteUser } = buildUseCases(userRepositoryFactory);

    const user = await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });

    expect(user.status).toBe('DISABLED');
  });

  it('produces the exact same result as calling transitionUserStatus with next=DISABLED', async () => {
    const factoryForDelete = new InMemoryUserRepositoryFactory();
    await seedUser(factoryForDelete);
    const factoryForTransition = new InMemoryUserRepositoryFactory();
    await seedUser(factoryForTransition);
    const { deleteUser } = buildUseCases(factoryForDelete);
    const { transitionUserStatus } = buildUseCases(factoryForTransition);

    const viaDelete = await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });
    const viaTransition = await transitionUserStatus({ auth: ORG_ADMIN, userId: 'user-1', next: 'DISABLED' });

    expect(viaDelete.status).toBe(viaTransition.status);
    expect(viaDelete.updatedAt).toBe(viaTransition.updatedAt);
  });

  it('fails identically to /transition when the user is already DISABLED', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const { deleteUser } = buildUseCases(userRepositoryFactory);
    await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });

    expect.assertions(2);
    try {
      await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it('inherits session revocation from TransitionUserStatus (DISABLED revokes all user sessions)', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const sessions = new InMemorySessionRepository();
    await sessions.save(buildSession('session-1'));
    const auditRecorder = new InMemoryAuditRecorder();
    const { deleteUser } = buildUseCases(userRepositoryFactory, sessions, auditRecorder);

    await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });

    const revoked = await sessions.findByTokenHash('token-hash-session-1');
    expect(revoked?.deletedAt).toBe(DELETED_AT);
    expect(auditRecorder.all().some((event) => event.action === 'USER_SESSIONS_REVOKED')).toBe(true);
  });
});
