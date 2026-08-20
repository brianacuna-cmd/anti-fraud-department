import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { OrganizationActorGateway } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/OrganizationActorGateway.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T01:00:00.000Z'));

describe('OrganizationActorGateway (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let organizations: MongoOrganizationRepository;
  let gateway: OrganizationActorGateway;

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
    gateway = new OrganizationActorGateway(organizations);
  });

  afterEach(async () => {
    await db.collection('organizations').deleteMany({});
  });

  it('resolves an organization with credentials by email, ignoring organizationSlug', async () => {
    await organizations.save(
      Organization.create({
        id: createOrganizationId(oid('org-creds')),
        name: 'Acme',
        slug: createSlug('acme'),
        email: createEmail('org@acme.example.com'),
        credential: createPasswordCredential('a-bcrypt-hash'),
        now: NOW,
      }),
    );

    const record = await gateway.findByEmail({ email: 'org@acme.example.com', organizationSlug: 'ignored' });

    expect(record).toEqual({
      actorId: oid('org-creds'),
      actorType: 'ORGANIZATION',
      organizationId: null,
      credential: { passwordHash: 'a-bcrypt-hash' },
      lockout: { loginAttempts: 0, blockedUntil: null },
      status: 'ACTIVE',
      mfa: { enabled: false, secret: null },
    });
  });

  it('returns null for an organization with no credentials yet (design D36 pulled forward)', async () => {
    await organizations.save(
      Organization.create({ id: createOrganizationId(oid('org-no-creds')), name: 'Bare', slug: createSlug('bare'), now: NOW }),
    );

    const record = await gateway.findByEmail({ email: 'bare@example.com' });

    expect(record).toBeNull();
  });

  it('returns null for an unknown email', async () => {
    const record = await gateway.findByEmail({ email: 'nobody@example.com' });

    expect(record).toBeNull();
  });

  it('registerLoginFailure then registerLoginSuccess round-trip through real persistence', async () => {
    await organizations.save(
      Organization.create({
        id: createOrganizationId(oid('org-lock')),
        name: 'Locky',
        slug: createSlug('locky'),
        email: createEmail('locky@example.com'),
        credential: createPasswordCredential('hash'),
        now: NOW,
      }),
    );
    const record = await gateway.findByEmail({ email: 'locky@example.com' });

    await gateway.registerLoginFailure(record!, { loginAttempts: 3, blockedUntil: LATER }, NOW);
    const lockedOrg = await organizations.findById(createOrganizationId(oid('org-lock')));
    expect(lockedOrg?.lockout).toEqual({ loginAttempts: 3, blockedUntil: LATER });

    await gateway.registerLoginSuccess(record!, LATER);
    const resetOrg = await organizations.findById(createOrganizationId(oid('org-lock')));
    expect(resetOrg?.lockout).toEqual({ loginAttempts: 0, blockedUntil: null });
  });
});
