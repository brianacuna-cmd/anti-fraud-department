import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { CaseDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildCase(id: string, organizationId = 'org-1'): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(42),
    priority: 'HIGH',
    now: NOW,
  });
}

describe('MongoCaseRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoCaseRepository;

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
    repository = new MongoCaseRepository(db);
  });

  afterEach(async () => {
    await db.collection('Cases').deleteMany({});
  });

  it('persists a case and retrieves it by id, tenant-scoped fields intact', async () => {
    await repository.save(buildCase('case-1'));

    const found = await repository.findById(createCaseId('case-1'));

    expect(found?.organizationId).toBe('org-1');
    expect(found?.customerId).toBe('customer-1');
    expect(found?.status).toBe('OPEN');
    expect(found?.riskScore).toBe(42);
    expect(found?.priority).toBe('HIGH');
  });

  it('returns null when no case matches the given id', async () => {
    const found = await repository.findById(createCaseId('missing'));

    expect(found).toBeNull();
  });

  it('round-trips a reassigned AssignedTo through the split AssignedTo/AssignedToType columns', async () => {
    const assigned = buildCase('case-2').reassign(createAssignedTo('ROLE', 'role-1'), NOW);
    await repository.save(assigned);

    const found = await repository.findById(createCaseId('case-2'));

    expect(found?.assignedTo).toEqual({ type: 'ROLE', id: 'role-1' });
  });

  it('participates in a given transaction: save() is rolled back when the transaction aborts', async () => {
    const unitOfWork = new MongoUnitOfWork(client);

    await expect(
      unitOfWork.withTransaction(async (tx) => {
        await repository.save(buildCase('case-tx'), tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const found = await repository.findById(createCaseId('case-tx'));
    expect(found).toBeNull();
  });

  /**
   * Regression guard mirroring `MongoOrganizationRepository`'s `_id`
   * invariant test: `_id` MUST stay the branded `CaseId` string, never a
   * driver-generated `ObjectId` (design ADR-0's override of the schema .md).
   */
  it('round-trips the raw document by _id as a plain string', async () => {
    await repository.save(buildCase('case-id-guard'));

    const rawDocument = await db.collection<CaseDocument>('Cases').findOne({ _id: 'case-id-guard' });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBe('case-id-guard');
    expect(typeof rawDocument?._id).toBe('string');
  });
});
