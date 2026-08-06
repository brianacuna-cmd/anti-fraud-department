import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

/** Loosely-typed raw document shape for reading collections bypassing the mapper on purpose. */
interface RawDocument {
  readonly _id: string;
  readonly [key: string]: unknown;
}

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId('org-pascal-1');

/**
 * Design A2/A4 (identity-access-schema-v2, PR3): the whole persistence layer
 * moves to PascalCase raw document keys, `_id` staying the single documented
 * exception (A1). This suite asserts the RAW driver-level shape — bypassing
 * the mapper on read the way the existing A1 guard does — so it fails loudly
 * if a rename is only partially applied (e.g. document interface renamed but
 * the mapper still writes camelCase, or vice-versa).
 */
describe('Identity-access Mongo persistence — PascalCase raw document shape (design A1/A2)', () => {
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
    await db.collection('Organizations').deleteMany({});
    await db.collection('Users').deleteMany({});
  });

  it('persists organizations under the PascalCase "Organizations" collection with PascalCase field keys', async () => {
    const organization = Organization.create({
      id: ORG_ID,
      name: 'Acme Corp',
      slug: createSlug('acme-corp-pascal'),
      domain: 'acme.example.com',
      logoUrl: null,
      now: NOW,
    });
    await organizations.save(organization);

    const rawDocument = await db.collection<RawDocument>('Organizations').findOne({ _id: ORG_ID });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument).toMatchObject({
      _id: ORG_ID,
      Name: 'Acme Corp',
      Slug: 'acme-corp-pascal',
      Domain: 'acme.example.com',
      Status: 'ACTIVE',
      LogoUrl: null,
      DeletedAt: null,
    });
    expect(typeof rawDocument?.CreatedAt).toBe('string');
    expect(typeof rawDocument?.UpdatedAt).toBe('string');
    // No stray camelCase leftovers and no `_Id` shadow field (A1).
    expect(rawDocument).not.toHaveProperty('name');
    expect(rawDocument).not.toHaveProperty('slug');
    expect(rawDocument).not.toHaveProperty('logoUrl');
    expect(rawDocument).not.toHaveProperty('createdAt');
    expect(rawDocument).not.toHaveProperty('_Id');
  });

  it('persists users under the PascalCase "Users" collection with PascalCase field keys', async () => {
    const userId = createUserId('user-pascal-1');
    const user = User.create({
      id: userId,
      organizationId: ORG_ID,
      email: createEmail('pascal@example.com'),
      credential: createPasswordCredential('a-bcrypt-hash'),
      firstName: 'Pascal',
      lastName: 'Case',
      now: NOW,
    });
    await userRepositoryFactory.forTenant(ORG_ID).save(user);

    const rawDocument = await db.collection<RawDocument>('Users').findOne({ _id: userId });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument).toMatchObject({
      _id: userId,
      OrganizationId: ORG_ID,
      Email: 'pascal@example.com',
      PasswordHash: 'a-bcrypt-hash',
      FirstName: 'Pascal',
      LastName: 'Case',
      AvatarUrl: null,
      Status: 'ACTIVE',
      IsPlatformAdmin: false,
    });
    expect(typeof rawDocument?.CreatedAt).toBe('string');
    expect(typeof rawDocument?.UpdatedAt).toBe('string');
    // No stray camelCase leftovers and no `_Id` shadow field (A1).
    expect(rawDocument).not.toHaveProperty('organizationId');
    expect(rawDocument).not.toHaveProperty('email');
    expect(rawDocument).not.toHaveProperty('passwordHash');
    expect(rawDocument).not.toHaveProperty('firstName');
    expect(rawDocument).not.toHaveProperty('_Id');
  });

  /**
   * Design A1 regression guard, extended to the renamed `Users` collection
   * (task 3.2 — the Organization half of this guard already exists in
   * `MongoOrganizationRepository.test.ts` and is updated in this same PR to
   * target the renamed `Organizations` collection).
   */
  it('round-trips the raw Users document by _id on the renamed collection (design A1 regression guard)', async () => {
    const userId = createUserId('user-id-guard');
    const user = User.create({
      id: userId,
      organizationId: ORG_ID,
      email: createEmail('id-guard@example.com'),
      credential: createPasswordCredential('hash'),
      firstName: 'Guard',
      lastName: 'Case',
      now: NOW,
    });
    await userRepositoryFactory.forTenant(ORG_ID).save(user);

    const rawDocument = await db.collection<RawDocument>('Users').findOne({ _id: 'user-id-guard' });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBe('user-id-guard');
    expect(typeof rawDocument?._id).toBe('string');
    expect(rawDocument).not.toHaveProperty('_Id');
  });

  /**
   * Task 3.3 — per-tenant email uniqueness pinned at the RAW document /
   * index level, on the renamed `Users` collection with PascalCase keys.
   * The application-level equivalent of this scenario already exists,
   * unmodified by this PR, in `MongoUserRepository.test.ts`
   * ("translates a duplicate {organizationId,email} write..." and "allows
   * the same email to be used across two different organizations"); this
   * test additionally pins the exact PascalCase compound index shape so a
   * partial rename (e.g. index re-keyed but collection not renamed) fails
   * loudly here instead of only surfacing as a silent index-shape drift.
   */
  it('enforces per-tenant email uniqueness via the PascalCase {OrganizationId, Email} compound index', async () => {
    const orgA = createOrganizationId('org-pascal-a');
    const orgB = createOrganizationId('org-pascal-b');

    await userRepositoryFactory.forTenant(orgA).save(
      User.create({
        id: createUserId('user-dup-a'),
        organizationId: orgA,
        email: createEmail('dup-pascal@example.com'),
        credential: createPasswordCredential('hash'),
        firstName: 'A',
        lastName: 'One',
        now: NOW,
      }),
    );

    // Same email, DIFFERENT organization: must persist successfully.
    await expect(
      userRepositoryFactory.forTenant(orgB).save(
        User.create({
          id: createUserId('user-dup-b'),
          organizationId: orgB,
          email: createEmail('dup-pascal@example.com'),
          credential: createPasswordCredential('hash'),
          firstName: 'B',
          lastName: 'Two',
          now: NOW,
        }),
      ),
    ).resolves.toBeUndefined();

    const indexes = await db.collection('Users').indexes();
    const emailIndex = indexes.find((index) => index.name === 'user_email_unique');
    expect(emailIndex?.key).toEqual({ OrganizationId: 1, Email: 1 });
    expect(emailIndex?.unique).toBe(true);
  });
});
