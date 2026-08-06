import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { BcryptPasswordHasher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/BcryptPasswordHasher.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { createCreateOrganizationWithAdminUseCase } from '../../../src/modules/identity-access/application/CreateOrganizationWithAdmin.js';
import type { PasswordHasher } from '../../../src/modules/identity-access/domain/ports/PasswordHasher.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { generateOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { generateUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { IdentityAccessError } from '../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

jest.setTimeout(120_000);

const PLATFORM_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'o0', isPlatformAdmin: true });

describe('CreateOrganizationWithAdmin bootstrap (integration, real replica-set Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let organizations: MongoOrganizationRepository;
  let userRepositoryFactory: MongoUserRepositoryFactory;

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
    organizations = new MongoOrganizationRepository(db);
    userRepositoryFactory = new MongoUserRepositoryFactory(db);
  });

  afterEach(async () => {
    await db.collection('organizations').deleteMany({});
    await db.collection('users').deleteMany({});
  });

  function buildUseCase(passwordHasher: PasswordHasher = new BcryptPasswordHasher()) {
    return createCreateOrganizationWithAdminUseCase({
      organizations,
      userRepositoryFactory,
      passwordHasher,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new SystemClock(),
      generateOrganizationId,
      generateUserId,
    });
  }

  it('commits BOTH the organization and the admin user in one transaction', async () => {
    const createOrganizationWithAdmin = buildUseCase();

    const organization = await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'admin@acme.com',
      adminPassword: 'super-secret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    const persistedOrg = await organizations.findBySlug(createSlug('acme-corp'));
    expect(persistedOrg?.id).toBe(organization.id);
    const adminUser = await userRepositoryFactory.forTenant(organization.id).findByEmail(createEmail('admin@acme.com'));
    expect(adminUser?.firstName).toBe('Root');
  });

  it('persists NEITHER document when the admin email is already taken across tenants', async () => {
    const createOrganizationWithAdmin = buildUseCase();
    await createOrganizationWithAdmin({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
      adminEmail: 'shared@example.com',
      adminPassword: 'super-secret',
      adminFirstName: 'Root',
      adminLastName: 'Admin',
    });

    expect.assertions(3);
    try {
      await createOrganizationWithAdmin({
        auth: PLATFORM_ADMIN,
        name: 'Globex',
        slug: 'globex',
        adminEmail: 'shared@example.com',
        adminPassword: 'super-secret',
        adminFirstName: 'New',
        adminLastName: 'Admin',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_EMAIL_TAKEN');
    }
    const globex = await organizations.findBySlug(createSlug('globex'));
    expect(globex).toBeNull();
  });

  it('rolls back the already-written organization when the admin user step fails mid-transaction', async () => {
    const failingHasher: PasswordHasher = {
      hash: async () => {
        throw new Error('hashing failure mid-transaction');
      },
      verify: async () => false,
    };
    const createOrganizationWithAdmin = buildUseCase(failingHasher);

    await expect(
      createOrganizationWithAdmin({
        auth: PLATFORM_ADMIN,
        name: 'Acme Corp',
        slug: 'acme-corp',
        adminEmail: 'admin@acme.com',
        adminPassword: 'super-secret',
        adminFirstName: 'Root',
        adminLastName: 'Admin',
      }),
    ).rejects.toThrow('hashing failure mid-transaction');

    const persistedOrg = await organizations.findBySlug(createSlug('acme-corp'));
    expect(persistedOrg).toBeNull();
    const anyUser = await userRepositoryFactory.existsByEmailAcrossTenants(createEmail('admin@acme.com'));
    expect(anyUser).toBe(false);
  });
});
