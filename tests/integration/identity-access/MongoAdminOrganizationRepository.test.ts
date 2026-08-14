import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoAdminOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoAdminOrganizationRepository.js';
import { AdminOrganization } from '../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey, type AdminKey } from '../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { AdminOrganizationDocument } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/AdminOrganizationDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function activeKey(keyId: string): AdminKey {
  return createAdminKey({
    keyId: createAdminKeyId(oid(keyId)),
    publicKey: `pub-${keyId}`,
    status: 'ACTIVE',
    encryptedPrivateKey: `cipher-${keyId}`,
    createdAt: NOW,
  });
}

function deprecatedKey(keyId: string): AdminKey {
  return createAdminKey({
    keyId: createAdminKeyId(oid(keyId)),
    publicKey: `pub-${keyId}`,
    status: 'DEPRECATED',
    encryptedPrivateKey: null,
    privateKeyDownloadedAt: NOW,
    createdAt: NOW,
    rotatedAt: LATER,
  });
}

function buildAdminOrganization(
  id: string,
  email: string,
  keys: readonly AdminKey[] = [activeKey('key-1')],
): AdminOrganization {
  return AdminOrganization.create({ id: createAdminOrganizationId(oid(id)), email: createEmail(email), keys, now: NOW });
}

describe('MongoAdminOrganizationRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoAdminOrganizationRepository;

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
    repository = new MongoAdminOrganizationRepository(db);
  });

  afterEach(async () => {
    await db.collection('adminOrganizations').deleteMany({});
  });

  it('persists an admin organization and retrieves it by id', async () => {
    await repository.save(buildAdminOrganization('admin-org-1', 'root@platform.test'));

    const found = await repository.findById(createAdminOrganizationId(oid('admin-org-1')));

    expect(found?.email).toBe('root@platform.test');
    expect(found?.keys).toHaveLength(1);
    expect(found?.keys[0]?.status).toBe('ACTIVE');
  });

  it('returns null when no admin organization matches the given id', async () => {
    const found = await repository.findById(createAdminOrganizationId(oid('missing')));

    expect(found).toBeNull();
  });

  it('round-trips a multi-key embedded array, preserving every field including nulls', async () => {
    const admin = buildAdminOrganization('admin-org-multi', 'multi@platform.test', [
      deprecatedKey('key-0'),
      activeKey('key-1'),
    ]);

    await repository.save(admin);
    const found = await repository.findById(createAdminOrganizationId(oid('admin-org-multi')));

    expect(found?.keys).toHaveLength(2);
    const deprecated = found?.findKey(createAdminKeyId(oid('key-0')));
    expect(deprecated?.status).toBe('DEPRECATED');
    expect(deprecated?.encryptedPrivateKey).toBeNull();
    expect(deprecated?.privateKeyDownloadedAt).toBe(NOW);
    expect(deprecated?.rotatedAt).toBe(LATER);
    expect(deprecated?.revokedAt).toBeNull();

    const active = found?.findKey(createAdminKeyId(oid('key-1')));
    expect(active?.status).toBe('ACTIVE');
    expect(active?.encryptedPrivateKey).toBe('cipher-key-1');
    expect(active?.privateKeyDownloadedAt).toBeNull();
  });

  it('finds an admin organization by email', async () => {
    await repository.save(buildAdminOrganization('admin-org-1', 'root@platform.test'));

    const found = await repository.findByEmail(createEmail('root@platform.test'));

    expect(found?.id).toBe(oid('admin-org-1'));
  });

  it('returns null when no admin organization matches the given email', async () => {
    const found = await repository.findByEmail(createEmail('nobody@platform.test'));

    expect(found).toBeNull();
  });

  it('countAll reflects inserted documents', async () => {
    expect(await repository.countAll()).toBe(0);

    await repository.save(buildAdminOrganization('admin-org-1', 'root1@platform.test'));
    expect(await repository.countAll()).toBe(1);

    await repository.save(buildAdminOrganization('admin-org-2', 'root2@platform.test'));
    expect(await repository.countAll()).toBe(2);
  });

  describe('claimPrivateKey (design D32a — atomic one-time-download CAS)', () => {
    it('claims the ciphertext once and nulls it out for the next call', async () => {
      await repository.save(buildAdminOrganization('admin-claim-1', 'claim1@platform.test'));

      const first = await repository.claimPrivateKey(
        createAdminOrganizationId(oid('admin-claim-1')),
        createAdminKeyId(oid('key-1')),
        LATER,
      );
      expect(first).toBe('cipher-key-1');

      const second = await repository.claimPrivateKey(
        createAdminOrganizationId(oid('admin-claim-1')),
        createAdminKeyId(oid('key-1')),
        LATER,
      );
      expect(second).toBeNull();

      const found = await repository.findById(createAdminOrganizationId(oid('admin-claim-1')));
      const key = found?.findKey(createAdminKeyId(oid('key-1')));
      expect(key?.encryptedPrivateKey).toBeNull();
      expect(key?.privateKeyDownloadedAt).toBe(LATER);
    });

    it('returns null for an unknown admin organization id', async () => {
      const result = await repository.claimPrivateKey(
        createAdminOrganizationId(oid('missing-admin')),
        createAdminKeyId(oid('key-1')),
        LATER,
      );
      expect(result).toBeNull();
    });

    it('returns null for an unknown keyId on a real admin organization', async () => {
      await repository.save(buildAdminOrganization('admin-claim-2', 'claim2@platform.test'));

      const result = await repository.claimPrivateKey(
        createAdminOrganizationId(oid('admin-claim-2')),
        createAdminKeyId(oid('nonexistent-key')),
        LATER,
      );
      expect(result).toBeNull();
    });

    it('two concurrent claims on the same key: exactly one winner gets the ciphertext, the other gets null', async () => {
      await repository.save(buildAdminOrganization('admin-claim-race', 'race@platform.test'));

      const [resultA, resultB] = await Promise.all([
        repository.claimPrivateKey(
          createAdminOrganizationId(oid('admin-claim-race')),
          createAdminKeyId(oid('key-1')),
          LATER,
        ),
        repository.claimPrivateKey(
          createAdminOrganizationId(oid('admin-claim-race')),
          createAdminKeyId(oid('key-1')),
          LATER,
        ),
      ]);

      const results = [resultA, resultB];
      const winners = results.filter((r) => r !== null);
      const losers = results.filter((r) => r === null);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(winners[0]).toBe('cipher-key-1');

      const found = await repository.findById(createAdminOrganizationId(oid('admin-claim-race')));
      expect(found?.findKey(createAdminKeyId(oid('key-1')))?.encryptedPrivateKey).toBeNull();
    });
  });

  /**
   * Regression guard for design D39/A1 (mirrors
   * MongoOrganizationRepository.test.ts's identical guard): `_id` MUST stay
   * lowercase and fields MUST stay camelCase, the verified-shipped
   * convention this module follows instead of the parent design's stated
   * PascalCase. This test reads the RAW document directly (bypassing the
   * mapper) so it fails if a later phase ever renames fields to PascalCase.
   */
  it('round-trips the raw document with camelCase fields (design D39 regression guard)', async () => {
    await repository.save(buildAdminOrganization('admin-org-id-guard', 'guard@platform.test'));

    const rawDocument = await db
      .collection<AdminOrganizationDocument>('adminOrganizations')
      .findOne({ _id: oid('admin-org-id-guard') });

    expect(rawDocument).not.toBeNull();
    expect(typeof rawDocument?._id).toBe('string');
    expect(rawDocument?._id.toString()).toBe(oid('admin-org-id-guard'));
    expect(rawDocument).not.toHaveProperty('_Id');
    expect(rawDocument?.email).toBe('guard@platform.test');
    expect(rawDocument?.keys[0]?.keyId.toString()).toBe(oid('key-1'));
    expect(rawDocument).not.toHaveProperty('Keys');
  });
});
