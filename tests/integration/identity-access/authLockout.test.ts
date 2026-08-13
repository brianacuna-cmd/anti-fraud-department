import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { UserActorGateway } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/UserActorGateway.js';
import { OrganizationActorGateway } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/OrganizationActorGateway.js';
import { createAuthenticateActorUseCase } from '../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createRoleId } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { InMemoryAuditRecorder } from '../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../helpers/FixedClock.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId(oid('org-lockout'));

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(IdentityAccessError);
  expect((caught as InstanceType<typeof IdentityAccessError>).code).toBe(code);
}

/**
 * Task 4.6 — real Mongo, real `ActorCredentialGateway` adapters for BOTH
 * tiers, proving `AuthenticateActor`'s lockout behavior is byte-identical
 * across Users and Organizations (account-lockout spec: "Lockout applies
 * identically across Users and Organizations").
 */
describe('Login lockout — identical across Users and Organizations (integration, real Mongo)', () => {
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

  beforeEach(async () => {
    organizations = new MongoOrganizationRepository(db);
    userRepositoryFactory = new MongoUserRepositoryFactory(db);

    await organizations.save(Organization.create({ id: ORG_ID, name: 'Acme', slug: createSlug('acme'), now: NOW }));
    await userRepositoryFactory.forTenant(ORG_ID).save(
      User.create({
        id: createUserId(oid('user-lockout')),
        organizationId: ORG_ID,
        email: createEmail('alice@example.com'),
        credential: createPasswordCredential('hashed:correct-password'),
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: createRoleId('ANALYST'),
        now: NOW,
      }),
    );
    await organizations.save(
      Organization.create({
        id: createOrganizationId(oid('org-actor-lockout')),
        name: 'Org Actor',
        slug: createSlug('org-actor'),
        email: createEmail('org@acme.example.com'),
        credential: createPasswordCredential('hashed:correct-password'),
        now: NOW,
      }),
    );
  });

  afterEach(async () => {
    await db.collection('Organizations').deleteMany({});
    await db.collection('Users').deleteMany({});
  });

  it('the 3rd consecutive failure locks BOTH a User and an Organization identically, real persistence round-tripped', async () => {
    const dummyCredential = createPasswordCredential('hashed:dummy-password');

    const authenticateUser = createAuthenticateActorUseCase({
      gateway: new UserActorGateway(organizations, userRepositoryFactory),
      passwordHasher: new FakePasswordHasher(),
      clock: new FixedClock(NOW),
      dummyCredential,
      actorType: 'USER',
      auditRecorder: new InMemoryAuditRecorder(),
    });
    const authenticateOrganization = createAuthenticateActorUseCase({
      gateway: new OrganizationActorGateway(organizations),
      passwordHasher: new FakePasswordHasher(),
      clock: new FixedClock(NOW),
      dummyCredential,
      actorType: 'ORGANIZATION',
      auditRecorder: new InMemoryAuditRecorder(),
    });

    const userLoginAttempt = () =>
      authenticateUser({ email: 'alice@example.com', password: 'wrong-password', organizationSlug: 'acme' });
    const orgLoginAttempt = () =>
      authenticateOrganization({ email: 'org@acme.example.com', password: 'wrong-password' });

    await expectCode(userLoginAttempt(), 'INVALID_CREDENTIALS');
    await expectCode(orgLoginAttempt(), 'INVALID_CREDENTIALS');
    await expectCode(userLoginAttempt(), 'INVALID_CREDENTIALS');
    await expectCode(orgLoginAttempt(), 'INVALID_CREDENTIALS');
    await expectCode(userLoginAttempt(), 'ACCOUNT_LOCKED');
    await expectCode(orgLoginAttempt(), 'ACCOUNT_LOCKED');

    const persistedUser = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId(oid('user-lockout')));
    const persistedOrganization = await organizations.findById(createOrganizationId(oid('org-actor-lockout')));

    expect(persistedUser?.lockout.loginAttempts).toBe(3);
    expect(persistedUser?.lockout.blockedUntil).not.toBeNull();
    expect(persistedOrganization?.lockout.loginAttempts).toBe(3);
    expect(persistedOrganization?.lockout.blockedUntil).not.toBeNull();
    // Identical shape across tiers: same attempt count, both locked.
    expect(persistedUser?.lockout.loginAttempts).toBe(persistedOrganization?.lockout.loginAttempts);
  });

  it('a subsequent correct-password attempt while locked still returns 423 for BOTH tiers, real persistence unchanged', async () => {
    const dummyCredential = createPasswordCredential('hashed:dummy-password');
    const passwordHasher = new FakePasswordHasher();
    const authenticateUser = createAuthenticateActorUseCase({
      gateway: new UserActorGateway(organizations, userRepositoryFactory),
      passwordHasher,
      clock: new FixedClock(NOW),
      dummyCredential,
      actorType: 'USER',
      auditRecorder: new InMemoryAuditRecorder(),
    });
    const authenticateOrganization = createAuthenticateActorUseCase({
      gateway: new OrganizationActorGateway(organizations),
      passwordHasher,
      clock: new FixedClock(NOW),
      dummyCredential,
      actorType: 'ORGANIZATION',
      auditRecorder: new InMemoryAuditRecorder(),
    });

    for (let i = 0; i < 3; i += 1) {
      await expectCode(
        authenticateUser({ email: 'alice@example.com', password: 'wrong-password', organizationSlug: 'acme' }),
        i < 2 ? 'INVALID_CREDENTIALS' : 'ACCOUNT_LOCKED',
      );
      await expectCode(
        authenticateOrganization({ email: 'org@acme.example.com', password: 'wrong-password' }),
        i < 2 ? 'INVALID_CREDENTIALS' : 'ACCOUNT_LOCKED',
      );
    }

    passwordHasher.verifyCallCount = 0;
    await expectCode(
      authenticateUser({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' }),
      'ACCOUNT_LOCKED',
    );
    await expectCode(
      authenticateOrganization({ email: 'org@acme.example.com', password: 'correct-password' }),
      'ACCOUNT_LOCKED',
    );
    // Blocked account skips the password check for BOTH tiers (account-lockout spec).
    expect(passwordHasher.verifyCallCount).toBe(0);
  });
});
