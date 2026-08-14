import { createListUsersUseCase } from '../../../../src/modules/identity-access/application/ListUsers.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: 'u1', organizationId: 'org-1', actorType: 'ORGANIZATION' });

async function seedUser(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  id: string,
  organizationId: string,
): Promise<void> {
  const org = createOrganizationId(organizationId);
  const user = User.create({
    id: createUserId(id),
    organizationId: org,
    email: createEmail(`${id}@example.com`),
    credential: createPasswordCredential('hash'),
    firstName: 'First',
    lastName: 'Last',
    roleId: createRoleId('ANALYST'),
    now: NOW,
  });
  await userRepositoryFactory.forTenant(org).save(user);
}

describe('createListUsersUseCase', () => {
  it('never leaks another organization\'s users', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'org-1');
    await seedUser(userRepositoryFactory, 'user-2', 'org-2');
    const listUsers = createListUsersUseCase({ userRepositoryFactory });

    const page = await listUsers({ auth: ORG_1_USER, limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe('user-1');
  });

  it('paginates within the caller\'s organization', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'user-1', 'org-1');
    await seedUser(userRepositoryFactory, 'user-2', 'org-1');
    const listUsers = createListUsersUseCase({ userRepositoryFactory });

    const firstPage = await listUsers({ auth: ORG_1_USER, limit: 1 });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
  });
});
