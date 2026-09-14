import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../helpers/mongoTestServer.js';
import { runBackfillCaseNumbers } from '../../scripts/backfillCaseNumbersCore.js';
import { oid } from '../support/oid.js';

jest.setTimeout(120_000);

describe('runBackfillCaseNumbers', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_backfill_test');
    client = connection.client;
    db = connection.db;
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  afterEach(async () => {
    await db.collection('cases').deleteMany({});
    await db.collection('case_number_counters').deleteMany({});
  });

  async function insertCase(id: string, org: string, createdAt: string, caseNumber?: string): Promise<void> {
    await db.collection('cases').insertOne({
      _id: new ObjectId(oid(id)),
      organization_id: new ObjectId(oid(org)),
      created_at: new Date(createdAt),
      ...(caseNumber !== undefined ? { case_number: caseNumber } : {}),
    });
  }

  async function numberOf(id: string): Promise<unknown> {
    return (await db.collection('cases').findOne({ _id: new ObjectId(oid(id)) }))?.case_number;
  }

  it('numbers old cases oldest-first per organization and year, and is idempotent', async () => {
    await insertCase('case-late', 'org-1', '2025-12-31T10:00:00.000Z');
    await insertCase('case-early', 'org-1', '2025-02-01T10:00:00.000Z');
    await insertCase('case-2026', 'org-1', '2026-01-05T10:00:00.000Z');
    await insertCase('case-other-org', 'org-2', '2025-06-01T10:00:00.000Z');

    const first = await runBackfillCaseNumbers(db);
    const second = await runBackfillCaseNumbers(db);

    expect(first.numberedCount).toBe(4);
    expect(second.numberedCount).toBe(0);
    expect(await numberOf('case-early')).toBe('FD-2025-000001');
    expect(await numberOf('case-late')).toBe('FD-2025-000002');
    expect(await numberOf('case-2026')).toBe('FD-2026-000001');
    expect(await numberOf('case-other-org')).toBe('FD-2025-000001');
  });

  it('leaves already numbered cases alone', async () => {
    await insertCase('case-numbered', 'org-1', '2026-01-01T10:00:00.000Z', 'FD-2026-000099');

    const result = await runBackfillCaseNumbers(db);

    expect(result.numberedCount).toBe(0);
    expect(await numberOf('case-numbered')).toBe('FD-2026-000099');
  });
});
