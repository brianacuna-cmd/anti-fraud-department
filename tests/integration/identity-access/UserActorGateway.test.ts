import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { UserActorGateway } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/UserActorGateway.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T01:00:00.000Z'));
const ORG_ID = createOrganizationId('org-1');

describe('UserActorGateway (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let organizations: MongoOrganizationRepository;
  let userRepositoryFactory: MongoUserRepositoryFactory;
  let gateway: UserActorGateway;

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
    gateway = new UserActorGateway(organizations, userRepositoryFactory);

    await organizations.save(
      Organization.create({ id: ORG_ID, name: 'Acme', slug: createSlug('acme'), now: NOW }),
    );
    await userRepositoryFactory.forTenant(ORG_ID).save(
      User.create({
        id: createUserId('user-1'),
        organizationId: ORG_ID,
        email: createEmail('alice@example.com'),
        credential: createPasswordCredential('a-bcrypt-hash'),
        firstName: 'Alice',
        lastName: 'Smith',
        now: NOW,
      }),
    );
  });

  afterEach(async () => {
    await db.collection('Organizations').deleteMany({});
    await db.collection('Users').deleteMany({});
  });

  it('resolves a user by {organizationSlug, email} (design D29)', async () => {
    const record = await gateway.findByEmail({ email: 'alice@example.com', organizationSlug: 'acme' });

    expect(record).toEqual({
      actorId: 'user-1',
      actorType: 'USER',
      organizationId: ORG_ID,
      credential: { passwordHash: 'a-bcrypt-hash' },
      lockout: { loginAttempts: 0, blockedUntil: null },
      status: 'ACTIVE',
    });
  });

  it('returns null when organizationSlug is missing (design D29 — required)', async () => {
    const record = await gateway.findByEmail({ email: 'alice@example.com' });

    expect(record).toBeNull();
  });

  it('returns null for an unknown organizationSlug (never surfaces ORGANIZATION_NOT_FOUND)', async () => {
    const record = await gateway.findByEmail({ email: 'alice@example.com', organizationSlug: 'globex' });

    expect(record).toBeNull();
  });

  it('returns null for an unknown email within a known organization', async () => {
    const record = await gateway.findByEmail({ email: 'nobody@example.com', organizationSlug: 'acme' });

    expect(record).toBeNull();
  });

  it('never falls back across tiers/organizations — same email in a different org does not resolve', async () => {
    const otherOrgId = createOrganizationId('org-2');
    await organizations.save(Organization.create({ id: otherOrgId, name: 'Globex', slug: createSlug('globex'), now: NOW }));

    const record = await gateway.findByEmail({ email: 'alice@example.com', organizationSlug: 'globex' });

    expect(record).toBeNull();
  });

  it('registerLoginFailure persists the given LockoutState against the resolved user', async () => {
    const record = await gateway.findByEmail({ email: 'alice@example.com', organizationSlug: 'acme' });

    await gateway.registerLoginFailure(record!, { loginAttempts: 2, blockedUntil: null }, LATER);

    const persisted = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(persisted?.lockout).toEqual({ loginAttempts: 2, blockedUntil: null });
    expect(persisted?.updatedAt).toBe(LATER);
  });

  it('registerLoginSuccess resets the LockoutState to zero', async () => {
    const record = await gateway.findByEmail({ email: 'alice@example.com', organizationSlug: 'acme' });
    await gateway.registerLoginFailure(record!, { loginAttempts: 2, blockedUntil: null }, NOW);

    await gateway.registerLoginSuccess(record!, LATER);

    const persisted = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId('user-1'));
    expect(persisted?.lockout).toEqual({ loginAttempts: 0, blockedUntil: null });
  });
});
