import { createGetUserUseCase } from '../../../../src/modules/identity-access/application/GetUser.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: 'u1', organizationId: 'org-1', isPlatformAdmin: false });
const ORG_2_USER = createAuthContext({ userId: 'u2', organizationId: 'org-2', isPlatformAdmin: false });

async function seedUser(userRepositoryFactory: InMemoryUserRepositoryFactory, organizationId = 'org-1'): Promise<void> {
  const org = createOrganizationId(organizationId);
  const user = User.create({
    id: createUserId('user-1'),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash', 'salt'),
    firstName: 'Alice',
    lastName: 'Smith',
    now: NOW,
  });
  await userRepositoryFactory.forTenant(org).save(user);
}

describe('createGetUserUseCase', () => {
  it('returns a user that belongs to the caller\'s own organization', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const getUser = createGetUserUseCase({ userRepositoryFactory });

    const user = await getUser({ auth: ORG_1_USER, userId: 'user-1' });

    expect(user.firstName).toBe('Alice');
  });

  it('rejects a cross-tenant read with USER_NOT_FOUND, never returning the other org\'s data', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'org-1');
    const getUser = createGetUserUseCase({ userRepositoryFactory });

    expect.assertions(2);
    try {
      await getUser({ auth: ORG_2_USER, userId: 'user-1' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('rejects an unknown id with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const getUser = createGetUserUseCase({ userRepositoryFactory });

    expect.assertions(2);
    try {
      await getUser({ auth: ORG_1_USER, userId: 'missing' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });
});
