import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import {
  CASE_NUMBER_COUNTERS_COLLECTION,
  MongoCaseNumberAllocator,
} from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseNumberAllocator.js';
import { MongoCaseRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createCaseNumber } from '../../../src/modules/case-management/domain/model/value-objects/CaseNumber.js';
import { createRiskScore } from '../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const IN_2026 = fromDate(new Date('2026-06-01T00:00:00.000Z'));
const IN_2027 = fromDate(new Date('2027-01-01T00:00:00.000Z'));

describe('MongoCaseNumberAllocator (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

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

  afterEach(async () => {
    await db.collection(CASE_NUMBER_COUNTERS_COLLECTION).deleteMany({});
    await db.collection('cases').deleteMany({});
  });

  it('counts per organization and restarts every year', async () => {
    const allocator = new MongoCaseNumberAllocator(db);

    expect(await allocator.allocate(oid('org-1'), IN_2026)).toBe('FD-2026-000001');
    expect(await allocator.allocate(oid('org-1'), IN_2026)).toBe('FD-2026-000002');
    expect(await allocator.allocate(oid('org-2'), IN_2026)).toBe('FD-2026-000001');
    expect(await allocator.allocate(oid('org-1'), IN_2027)).toBe('FD-2027-000001');
  });

  it('never hands out the same number twice under concurrency', async () => {
    const allocator = new MongoCaseNumberAllocator(db);

    const numbers = await Promise.all(Array.from({ length: 25 }, () => allocator.allocate(oid('org-1'), IN_2026)));

    expect(new Set(numbers).size).toBe(25);
  });

  it('persists the number on the case and rejects a duplicate within the same tenant', async () => {
    const repository = new MongoCaseRepository(db);
    const build = (id: string) =>
      Case.create({
        id: createCaseId(id),
        caseNumber: createCaseNumber('FD-2026-000007'),
        organizationId: oid('org-1'),
        customerId: 'customer-1',
        riskScore: createRiskScore(10),
        priority: 'LOW',
        now: IN_2026,
      });

    await repository.save(build(oid('case-a')));
    expect((await repository.findById(createCaseId(oid('case-a'))))?.caseNumber).toBe('FD-2026-000007');
    await expect(repository.save(build(oid('case-b')))).rejects.toMatchObject({ code: 11000 });
  });
});
