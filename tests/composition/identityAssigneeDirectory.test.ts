import { oid } from '../support/oid.js';
import { createIdentityAssigneeDirectory } from '../../src/composition/identityAssigneeDirectory.js';
import { InMemoryUserRepositoryFactory } from '../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import type { RoleRepository, RoleView } from '../../src/modules/identity-access/domain/ports/RoleRepository.js';
import type { RoleId } from '../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { User } from '../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { createRoleId } from '../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createTransitionActor } from '../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { fromDate } from '../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const CREDENTIAL = createPasswordCredential('hash-value');

/** No roles registered — these tests only exercise the USER branch. */
class NoRoleRepository implements RoleRepository {
  async findById(): Promise<RoleView | null> {
    return null;
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async isAssignableToUser(): Promise<boolean> {
    return false;
  }
}

function buildUser(id: string, status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'DISABLED'): User {
  const created = User.create({
    id: createUserId(id),
    organizationId: createOrganizationId(ORG),
    email: createEmail(`${id}@example.com`),
    credential: CREDENTIAL,
    firstName: 'Test',
    lastName: 'User',
    roleId: createRoleId('ANALYST') as RoleId,
    now: NOW,
  });
  if (status === 'ACTIVE') return created;
  return created.transitionTo(status, createTransitionActor(true), NOW);
}

describe('createIdentityAssigneeDirectory — belongsToOrganization (USER)', () => {
  it('accepts an ACTIVE user of the organization', async () => {
    const users = new InMemoryUserRepositoryFactory();
    const userId = oid('user-active');
    await users.forTenant(createOrganizationId(ORG)).save(buildUser(userId, 'ACTIVE'));
    const directory = createIdentityAssigneeDirectory(users, new NoRoleRepository());

    const result = await directory.belongsToOrganization(ORG, { type: 'USER', id: userId });

    expect(result).toBe(true);
  });

  it('rejects a SUSPENDED user — a case must not end up assigned to someone who cannot work it', async () => {
    const users = new InMemoryUserRepositoryFactory();
    const userId = oid('user-suspended');
    await users.forTenant(createOrganizationId(ORG)).save(buildUser(userId, 'SUSPENDED'));
    const directory = createIdentityAssigneeDirectory(users, new NoRoleRepository());

    const result = await directory.belongsToOrganization(ORG, { type: 'USER', id: userId });

    expect(result).toBe(false);
  });

  it('rejects a DISABLED user', async () => {
    const users = new InMemoryUserRepositoryFactory();
    const userId = oid('user-disabled');
    await users.forTenant(createOrganizationId(ORG)).save(buildUser(userId, 'DISABLED'));
    const directory = createIdentityAssigneeDirectory(users, new NoRoleRepository());

    const result = await directory.belongsToOrganization(ORG, { type: 'USER', id: userId });

    expect(result).toBe(false);
  });

  it('rejects a user id that does not exist at all', async () => {
    const users = new InMemoryUserRepositoryFactory();
    const directory = createIdentityAssigneeDirectory(users, new NoRoleRepository());

    const result = await directory.belongsToOrganization(ORG, { type: 'USER', id: oid('ghost') });

    expect(result).toBe(false);
  });
});
