import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoUserRepositoryFactory } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = createOrganizationId(oid('org-1'));
const ORG_2 = createOrganizationId(oid('org-2'));

function buildUser(id: string, organizationId = ORG_1, email = `${id}@example.com`): User {
  return User.create({
    id: createUserId(id),
    organizationId,
    email: createEmail(email),
    credential: createPasswordCredential('hash'),
    firstName: 'First',
    lastName: 'Last',
    roleId: createRoleId('ANALYST'),
    now: NOW,
  });
}

describe('MongoUserRepositoryFactory / MongoUserRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let factory: MongoUserRepositoryFactory;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    factory = new MongoUserRepositoryFactory(db);
  });

  afterEach(async () => {
    await db.collection('users').deleteMany({});
  });

  it('persists a user and retrieves it by id, scoped to the bound tenant', async () => {
    const repository = factory.forTenant(ORG_1);
    await repository.save(buildUser(oid('user-1'), ORG_1, 'user-1@example.com'));

    const found = await repository.findById(createUserId(oid('user-1')));

    expect(found?.email).toBe('user-1@example.com');
    expect(found?.organizationId).toBe(oid('org-1'));
  });

  it('never returns a user that belongs to a different tenant', async () => {
    await factory.forTenant(ORG_1).save(buildUser(oid('user-1'), ORG_1));

    const found = await factory.forTenant(ORG_2).findById(createUserId(oid('user-1')));

    expect(found).toBeNull();
  });

  it('listByRole returns only ACTIVE users with the given role, scoped to the bound tenant', async () => {
    const repo1 = factory.forTenant(ORG_1);
    await repo1.save(buildUser(oid('user-analyst'), ORG_1, 'analyst@example.com'));
    await repo1.save(
      buildUser(oid('user-sup'), ORG_1, 'sup@example.com').changeRole(createRoleId('SUPERVISOR'), NOW),
    );
    await repo1.save(
      buildUser(oid('user-disabled'), ORG_1, 'disabled@example.com').transitionTo(
        'DISABLED',
        { isPlatformAdmin: true },
        NOW,
      ),
    );
    await factory.forTenant(ORG_2).save(buildUser(oid('user-other-org'), ORG_2, 'other@example.com'));

    const recipients = await repo1.listByRole(createRoleId('ANALYST'));

    expect(recipients.map((user) => user.id)).toEqual([oid('user-analyst')]);
  });

  it('finds a user by email within the bound tenant', async () => {
    const repository = factory.forTenant(ORG_1);
    await repository.save(buildUser(oid('user-1'), ORG_1, 'user-1@example.com'));

    const found = await repository.findByEmail(createEmail('user-1@example.com'));

    expect(found?.id).toBe(oid('user-1'));
  });

  it('translates a duplicate {organizationId,email} write into USER_EMAIL_TAKEN by index name', async () => {
    const repository = factory.forTenant(ORG_1);
    await repository.save(buildUser(oid('user-1'), ORG_1, 'dup@example.com'));

    expect.assertions(2);
    try {
      await repository.save(buildUser(oid('user-2'), ORG_1, 'dup@example.com'));
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_EMAIL_TAKEN');
    }
  });

  it('allows the same email to be used across two different organizations', async () => {
    await factory.forTenant(ORG_1).save(buildUser(oid('user-1'), ORG_1, 'shared@example.com'));

    await expect(factory.forTenant(ORG_2).save(buildUser(oid('user-2'), ORG_2, 'shared@example.com'))).resolves.toBeUndefined();
  });

  it('paginates results within the bound tenant', async () => {
    const repository = factory.forTenant(ORG_1);
    await repository.save(buildUser(oid('user-1')));
    await repository.save(buildUser(oid('user-2')));
    await factory.forTenant(ORG_2).save(buildUser(oid('user-3'), ORG_2));

    const page = await repository.list(1);

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
  });

  describe('existsByEmailAcrossTenants', () => {
    it('returns true when the email exists in ANY organization', async () => {
      await factory.forTenant(ORG_1).save(buildUser(oid('user-1'), ORG_1, 'admin@example.com'));

      const exists = await factory.existsByEmailAcrossTenants(createEmail('admin@example.com'));

      expect(exists).toBe(true);
    });

    it('returns false when the email does not exist in any organization', async () => {
      const exists = await factory.existsByEmailAcrossTenants(createEmail('nobody@example.com'));

      expect(exists).toBe(false);
    });
  });

  describe('transaction participation', () => {
    it('save() is rolled back when the given transaction aborts', async () => {
      const unitOfWork = new MongoUnitOfWork(client);
      const repository = factory.forTenant(ORG_1);

      await expect(
        unitOfWork.withTransaction(async (tx) => {
          await repository.save(buildUser(oid('user-tx')), tx);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const found = await repository.findById(createUserId(oid('user-tx')));
      expect(found).toBeNull();
    });
  });
});
