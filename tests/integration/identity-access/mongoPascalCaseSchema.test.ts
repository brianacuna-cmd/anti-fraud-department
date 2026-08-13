import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createRoleId } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

/** Loosely-typed raw document shape for reading collections bypassing the mapper on purpose. */
interface RawDocument {
  readonly _id: import('mongodb').ObjectId;
  readonly [key: string]: unknown;
}

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId(oid('org-pascal-1'));

/**
 * Design A2/A4 (identity-access-schema-v2, PR3): the whole persistence layer
 * moves to PascalCase raw document keys, `_id` staying the single documented
 * exception (A1). This suite asserts the RAW driver-level shape — bypassing
 * the mapper on read the way the existing A1 guard does — so it fails loudly
 * if a rename is only partially applied (e.g. document interface renamed but
 * the mapper still writes camelCase, or vice-versa).
 */
describe('Identity-access Mongo persistence — snake_case raw document shape', () => {
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

  it('persists organizations under the snake_case "organizations" collection with snake_case field keys', async () => {
    const organization = Organization.create({
      id: ORG_ID,
      name: 'Acme Corp',
      slug: createSlug('acme-corp-pascal'),
      domain: 'acme.example.com',
      now: NOW,
    });
    await organizations.save(organization);

    const rawDocument = await db.collection<RawDocument>('organizations').findOne({ _id: new ObjectId(ORG_ID) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument).toMatchObject({
      _id: new ObjectId(ORG_ID),
      name: 'Acme Corp',
      slug: 'acme-corp-pascal',
      domain: 'acme.example.com',
      status: 'ACTIVE',
      configuration: {},
      deleted_at: null,
    });
    expect(rawDocument?.created_at).toBeInstanceOf(Date);
    expect(rawDocument?.updated_at).toBeInstanceOf(Date);
    expect(rawDocument).not.toHaveProperty('Name');
    expect(rawDocument).not.toHaveProperty('Slug');
    expect(rawDocument).not.toHaveProperty('createdAt');
    expect(rawDocument).not.toHaveProperty('logoUrl');
    expect(rawDocument).not.toHaveProperty('LogoUrl');
    expect(rawDocument).not.toHaveProperty('_Id');
  });

  it('persists users under the snake_case "users" collection with snake_case field keys', async () => {
    const userId = createUserId(oid('user-pascal-1'));
    const user = User.create({
      id: userId,
      organizationId: ORG_ID,
      email: createEmail('pascal@example.com'),
      credential: createPasswordCredential('a-bcrypt-hash'),
      firstName: 'Pascal',
      middleName: 'Middle',
      lastName: 'Case',
      roleId: createRoleId('ANALYST'),
      now: NOW,
    });
    await userRepositoryFactory.forTenant(ORG_ID).save(user);

    const rawDocument = await db.collection<RawDocument>('users').findOne({ _id: new ObjectId(userId) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument).toMatchObject({
      _id: new ObjectId(userId),
      organization_id: new ObjectId(ORG_ID),
      email: 'pascal@example.com',
      password_hash: 'a-bcrypt-hash',
      first_name: 'Pascal',
      middle_name: 'Middle',
      last_name: 'Case',
      avatar_url: null,
      status: 'ACTIVE',
      is_platform_admin: false,
      reset_token: null,
      mfa: { secret: null, enabled: false, recovery_codes: [] },
    });
    expect(rawDocument?.created_at).toBeInstanceOf(Date);
    expect(rawDocument?.updated_at).toBeInstanceOf(Date);
    expect(rawDocument).not.toHaveProperty('organizationId');
    expect(rawDocument).not.toHaveProperty('OrganizationId');
    expect(rawDocument).not.toHaveProperty('firstName');
    expect(rawDocument).not.toHaveProperty('FirstName');
    expect(rawDocument).not.toHaveProperty('passwordHash');
    expect(rawDocument).not.toHaveProperty('resetToken');
    expect(rawDocument).not.toHaveProperty('Mfa');
    expect(rawDocument).not.toHaveProperty('_Id');
  });

  /**
   * Task 5.7/5.8 (schema-v2 PR5) — net-new fields round-trip through the
   * mapper (`toDocument`/`toDomain`), not just the raw document shape. Pins
   * that a NON-default `MiddleName`/`ResetToken`/`Mfa`/`Configuration` value
   * survives a full save→findById round trip, and confirms the `_id` guard
   * (task 1.7) still holds end-to-end with the extended field set.
   */
  it('round-trips MiddleName/ResetToken/Mfa (User) and Configuration (Organization) through the mapper', async () => {
    const organization = Organization.create({
      id: ORG_ID,
      name: 'Acme Corp',
      slug: createSlug('acme-corp-roundtrip'),
      now: NOW,
    });
    await organizations.save(organization);
    const persistedOrganization = await organizations.findById(ORG_ID);
    expect(persistedOrganization?.configuration).toEqual({});

    const userId = createUserId(oid('user-roundtrip-1'));
    const user = User.create({
      id: userId,
      organizationId: ORG_ID,
      email: createEmail('roundtrip@example.com'),
      credential: createPasswordCredential('hash'),
      firstName: 'Round',
      middleName: 'Trip',
      lastName: 'Case',
      roleId: createRoleId('ANALYST'),
      now: NOW,
    });
    await userRepositoryFactory.forTenant(ORG_ID).save(user);

    const persistedUser = await userRepositoryFactory.forTenant(ORG_ID).findById(userId);
    expect(persistedUser?.id).toBe(userId);
    expect(persistedUser?.middleName).toBe('Trip');
    expect(persistedUser?.resetToken).toBeNull();
    expect(persistedUser?.mfa).toEqual({ secret: null, enabled: false, recoveryCodes: [] });
  });

  /**
   * Design A1 regression guard, extended to the renamed `Users` collection
   * (task 3.2 — the Organization half of this guard already exists in
   * `MongoOrganizationRepository.test.ts` and is updated in this same PR to
   * target the renamed `Organizations` collection).
   */
  it('round-trips the raw Users document by _id on the renamed collection (design A1 regression guard)', async () => {
    const userId = createUserId(oid('user-id-guard'));
    const user = User.create({
      id: userId,
      organizationId: ORG_ID,
      email: createEmail('id-guard@example.com'),
      credential: createPasswordCredential('hash'),
      firstName: 'Guard',
      lastName: 'Case',
      roleId: createRoleId('ANALYST'),
      now: NOW,
    });
    await userRepositoryFactory.forTenant(ORG_ID).save(user);

    const rawDocument = await db.collection<RawDocument>('users').findOne({ _id: new ObjectId(oid('user-id-guard')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBeInstanceOf(ObjectId);
    expect(rawDocument?._id.toString()).toBe(oid('user-id-guard'));
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
  it('enforces per-tenant email uniqueness via the PascalCase {organization_id, email} compound index', async () => {
    const orgA = createOrganizationId(oid('org-pascal-a'));
    const orgB = createOrganizationId(oid('org-pascal-b'));

    await userRepositoryFactory.forTenant(orgA).save(
      User.create({
        id: createUserId(oid('user-dup-a')),
        organizationId: orgA,
        email: createEmail('dup-pascal@example.com'),
        credential: createPasswordCredential('hash'),
        firstName: 'A',
        lastName: 'One',
        roleId: createRoleId('ANALYST'),
        now: NOW,
      }),
    );

    // Same email, DIFFERENT organization: must persist successfully.
    await expect(
      userRepositoryFactory.forTenant(orgB).save(
        User.create({
          id: createUserId(oid('user-dup-b')),
          organizationId: orgB,
          email: createEmail('dup-pascal@example.com'),
          credential: createPasswordCredential('hash'),
          firstName: 'B',
          lastName: 'Two',
          roleId: createRoleId('ANALYST'),
          now: NOW,
        }),
      ),
    ).resolves.toBeUndefined();

    const indexes = await db.collection('users').indexes();
    const emailIndex = indexes.find((index) => index.name === 'user_email_unique');
    expect(emailIndex?.key).toEqual({ organization_id: 1, email: 1 });
    expect(emailIndex?.unique).toBe(true);
  });
});
