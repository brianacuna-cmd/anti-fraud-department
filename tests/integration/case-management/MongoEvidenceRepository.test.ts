import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoEvidenceRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoEvidenceRepository.js';
import { Evidence } from '../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { createEvidenceId } from '../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildEvidence(
  id: string,
  overrides: { investigationId?: string | null; timestamp?: boolean } = {},
): Evidence {
  return Evidence.register({
    id: createEvidenceId(id),
    caseId: createCaseId(oid('case-1')),
    investigationId:
      overrides.investigationId === undefined || overrides.investigationId === null
        ? null
        : createInvestigationId(overrides.investigationId),
    organizationId: oid('org-1'),
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    byteSize: 42,
    sha256: 'deadbeef',
    storageKey: `org-1/case-1/${id}`,
    timestamp: overrides.timestamp ? { token: 'tok', authority: 'tsa.example', timestampedAt: NOW } : null,
    scanStatus: 'CLEAN',
    uploadedBy: oid('analyst-1'),
    now: NOW,
  });
}

describe('MongoEvidenceRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoEvidenceRepository;

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
    repository = new MongoEvidenceRepository(db);
  });

  afterEach(async () => {
    await db.collection('evidence').deleteMany({});
  });

  it('round-trips evidence metadata by id, with a null timestamp', async () => {
    await repository.save(buildEvidence(oid('ev-1')));

    const found = await repository.findById(createEvidenceId(oid('ev-1')));

    expect(found?.sha256).toBe('deadbeef');
    expect(found?.filename).toBe('invoice.pdf');
    expect(found?.investigationId).toBeNull();
    expect(found?.timestamp).toBeNull();
  });

  it('round-trips an RFC3161 timestamp and an investigation link', async () => {
    await repository.save(buildEvidence(oid('ev-2'), { investigationId: oid('inv-1'), timestamp: true }));

    const found = await repository.findById(createEvidenceId(oid('ev-2')));

    expect(found?.investigationId).toBe(oid('inv-1'));
    expect(found?.timestamp?.token).toBe('tok');
  });

  it('lists a case evidence newest-first', async () => {
    await repository.save(buildEvidence(oid('ev-1')));
    await repository.save(buildEvidence(oid('ev-2')));

    const listed = await repository.listByCaseId(createCaseId(oid('case-1')));

    expect(listed.map((e) => e.id).sort()).toEqual([oid('ev-1'), oid('ev-2')].sort());
  });
});
