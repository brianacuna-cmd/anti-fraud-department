import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoOrganizationRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildOrganization(id: string, slug: string): Organization {
  return Organization.create({ id: createOrganizationId(id), name: `Org ${id}`, slug: createSlug(slug), now: NOW });
}

describe('MongoOrganizationRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoOrganizationRepository;

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
    repository = new MongoOrganizationRepository(db);
  });

  afterEach(async () => {
    await db.collection('organizations').deleteMany({});
  });

  it('persists an organization and retrieves it by id', async () => {
    await repository.save(buildOrganization('org-1', 'acme'));

    const found = await repository.findById(createOrganizationId('org-1'));

    expect(found?.name).toBe('Org org-1');
    expect(found?.slug).toBe('acme');
    expect(found?.status).toBe('ACTIVO');
  });

  it('retrieves an organization by slug', async () => {
    await repository.save(buildOrganization('org-1', 'acme'));

    const found = await repository.findBySlug(createSlug('acme'));

    expect(found?.id).toBe('org-1');
  });

  it('returns null when no organization matches the given id', async () => {
    const found = await repository.findById(createOrganizationId('missing'));

    expect(found).toBeNull();
  });

  it('translates a duplicate slug write into ORGANIZATION_SLUG_TAKEN by index name, not message parsing', async () => {
    await repository.save(buildOrganization('org-1', 'acme'));

    expect.assertions(2);
    try {
      await repository.save(buildOrganization('org-2', 'acme'));
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_SLUG_TAKEN');
    }
  });

  it('paginates results in ascending _id order with a usable next cursor', async () => {
    await repository.save(buildOrganization('org-1', 'acme'));
    await repository.save(buildOrganization('org-2', 'globex'));
    await repository.save(buildOrganization('org-3', 'initech'));

    const firstPage = await repository.list(2);
    expect(firstPage.items.map((organization) => organization.id)).toEqual(['org-1', 'org-2']);
    expect(firstPage.nextCursor).toBe('org-2');

    const secondPage = await repository.list(2, firstPage.nextCursor!);
    expect(secondPage.items.map((organization) => organization.id)).toEqual(['org-3']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('participates in a given transaction: save() is rolled back when the transaction aborts', async () => {
    const unitOfWork = new MongoUnitOfWork(client);

    await expect(
      unitOfWork.withTransaction(async (tx) => {
        await repository.save(buildOrganization('org-tx', 'tx-org'), tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const found = await repository.findById(createOrganizationId('org-tx'));
    expect(found).toBeNull();
  });

  it('findBySlug() participates in a given transaction and sees prior writes made in it', async () => {
    const unitOfWork = new MongoUnitOfWork(client);

    const foundWithinTransaction = await unitOfWork.withTransaction(async (tx) => {
      await repository.save(buildOrganization('org-tx-2', 'tx-org-2'), tx);
      return repository.findBySlug(createSlug('tx-org-2'), tx);
    });

    expect(foundWithinTransaction?.id).toBe('org-tx-2');
  });
});
