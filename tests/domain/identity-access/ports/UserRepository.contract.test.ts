import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CREDENTIAL = createPasswordCredential('hash');
const ORG_1 = createOrganizationId('org-1');
const ORG_2 = createOrganizationId('org-2');

function buildUser(id: string, organizationId = ORG_1, email = `${id}@example.com`): User {
  return User.create({
    id: createUserId(id),
    organizationId,
    email: createEmail(email),
    credential: CREDENTIAL,
    firstName: 'First',
    lastName: 'Last',
    now: NOW,
  });
}

describe('UserRepository (port contract, via InMemoryUserRepositoryFactory fake)', () => {
  it('returns null from findById when nothing has been saved', async () => {
    const repository = new InMemoryUserRepositoryFactory().forTenant(ORG_1);

    const result = await repository.findById(createUserId('missing'));

    expect(result).toBeNull();
  });

  it('persists and retrieves a user by id, scoped to the bound tenant', async () => {
    const factory = new InMemoryUserRepositoryFactory();
    const repository = factory.forTenant(ORG_1);
    await repository.save(buildUser('user-1'));

    const found = await repository.findById(createUserId('user-1'));

    expect(found?.id).toBe('user-1');
    expect(found?.email).toBe('user-1@example.com');
  });

  it('never returns a user that belongs to a different tenant', async () => {
    const factory = new InMemoryUserRepositoryFactory();
    await factory.forTenant(ORG_1).save(buildUser('user-1', ORG_1));

    const found = await factory.forTenant(ORG_2).findById(createUserId('user-1'));

    expect(found).toBeNull();
  });

  it('retrieves a user by email within the bound tenant', async () => {
    const factory = new InMemoryUserRepositoryFactory();
    const repository = factory.forTenant(ORG_1);
    await repository.save(buildUser('user-1'));

    const found = await repository.findByEmail(createEmail('user-1@example.com'));

    expect(found?.id).toBe('user-1');
  });

  it('does not find an email belonging to another tenant', async () => {
    const factory = new InMemoryUserRepositoryFactory();
    await factory.forTenant(ORG_1).save(buildUser('user-1', ORG_1, 'shared@example.com'));

    const found = await factory.forTenant(ORG_2).findByEmail(createEmail('shared@example.com'));

    expect(found).toBeNull();
  });

  it('overwrites the stored user when saving the same id again', async () => {
    const factory = new InMemoryUserRepositoryFactory();
    const repository = factory.forTenant(ORG_1);
    await repository.save(buildUser('user-1'));
    const suspended = (await repository.findById(createUserId('user-1')))!.transitionTo(
      'SUSPENDED',
      { isPlatformAdmin: true },
      NOW,
    );

    await repository.save(suspended);

    const found = await repository.findById(createUserId('user-1'));
    expect(found?.status).toBe('SUSPENDED');
  });

  describe('list', () => {
    it('returns only the bound tenant\'s users, paginated', async () => {
      const factory = new InMemoryUserRepositoryFactory();
      await factory.forTenant(ORG_1).save(buildUser('user-1'));
      await factory.forTenant(ORG_1).save(buildUser('user-2'));
      await factory.forTenant(ORG_2).save(buildUser('user-3', ORG_2));

      const page = await factory.forTenant(ORG_1).list(10);

      expect(page.items).toHaveLength(2);
      expect(page.items.map((user) => user.id)).toEqual(['user-1', 'user-2']);
      expect(page.nextCursor).toBeNull();
    });
  });
});
