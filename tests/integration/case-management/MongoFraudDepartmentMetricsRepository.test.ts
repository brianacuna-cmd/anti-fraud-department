import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoFraudDepartmentMetricsRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoFraudDepartmentMetricsRepository.js';
import { FraudDepartmentMetrics } from '../../../src/modules/case-management/domain/model/aggregates/FraudDepartmentMetrics.js';
import { fromDate, toDate } from '../../../src/shared/time/Instant.js';
import { extractDuplicateKeyIndexName } from '../../../src/shared/persistence/mongo/duplicateKey.js';
import type { FraudDepartmentMetricsDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/FraudDepartmentMetricsDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-09-09T00:00:00.000Z'));

function buildMetrics(overrides: Partial<Parameters<typeof FraudDepartmentMetrics.create>[0]> = {}) {
  return FraudDepartmentMetrics.create({
    organizationId: oid('org-1'),
    fecha: '2026-09-09',
    casosAbiertos: 2,
    casosCerrados: 1,
    slaCompliancePct: 75,
    precisionModelo: 0.6667,
    falsePositiveRate: 0.4,
    now: NOW,
    ...overrides,
  });
}

describe('MongoFraudDepartmentMetricsRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoFraudDepartmentMetricsRepository;

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
    repository = new MongoFraudDepartmentMetricsRepository(db);
  });

  afterEach(async () => {
    await db.collection('fraud_department_metrics').deleteMany({});
  });

  it('inserts a new row and finds it by organization and fecha', async () => {
    await repository.upsert(buildMetrics());

    const found = await repository.findByOrgAndDate(oid('org-1'), '2026-09-09');

    expect(found?.organizationId).toBe(oid('org-1'));
    expect(found?.fecha).toBe('2026-09-09');
    expect(found?.casosAbiertos).toBe(2);
    expect(found?.casosCerrados).toBe(1);
    expect(found?.slaCompliancePct).toBe(75);
    expect(found?.precisionModelo).toBe(0.6667);
    expect(found?.falsePositiveRate).toBe(0.4);
  });

  it('null ratio fields round-trip as null (zero-activity row)', async () => {
    await repository.upsert(
      buildMetrics({
        casosAbiertos: 0,
        casosCerrados: 0,
        slaCompliancePct: null,
        precisionModelo: null,
        falsePositiveRate: null,
      }),
    );

    const found = await repository.findByOrgAndDate(oid('org-1'), '2026-09-09');

    expect(found?.casosAbiertos).toBe(0);
    expect(found?.casosCerrados).toBe(0);
    expect(found?.slaCompliancePct).toBeNull();
    expect(found?.precisionModelo).toBeNull();
    expect(found?.falsePositiveRate).toBeNull();
  });

  it('returns null when no row matches the given organization/fecha', async () => {
    const found = await repository.findByOrgAndDate(oid('missing-org'), '2026-09-09');

    expect(found).toBeNull();
  });

  it('upsert is idempotent: a second call for the same (org, fecha) updates in place, never a duplicate', async () => {
    await repository.upsert(buildMetrics());
    await repository.upsert(buildMetrics({ casosAbiertos: 3, slaCompliancePct: 80 }));

    const documents = await db
      .collection<FraudDepartmentMetricsDocument>('fraud_department_metrics')
      .find({ organization_id: new ObjectId(oid('org-1')), fecha: '2026-09-09' })
      .toArray();

    expect(documents).toHaveLength(1);
    expect(documents[0]?.casos_abiertos).toBe(3);
    expect(documents[0]?.sla_compliance_pct).toBe(80);
  });

  it('preserves created_at across a re-upsert (only $setOnInsert on first write)', async () => {
    await repository.upsert(buildMetrics());
    const firstFound = await repository.findByOrgAndDate(oid('org-1'), '2026-09-09');

    const LATER = fromDate(new Date('2026-09-10T00:00:00.000Z'));
    await repository.upsert(buildMetrics({ casosAbiertos: 5, now: LATER }));
    const secondFound = await repository.findByOrgAndDate(oid('org-1'), '2026-09-09');

    expect(secondFound?.createdAt).toEqual(firstFound?.createdAt);
  });

  /**
   * Regression guard for the `fraud_department_metrics_org_fecha_unique`
   * index: a raw insert bypassing the repository's upsert-by-natural-key
   * path (e.g. a second document minted with a DIFFERENT `_id` for the same
   * (organization_id, fecha)) MUST be rejected by Mongo itself.
   */
  it('rejects a raw duplicate (organization_id, fecha) insert via the unique index', async () => {
    await repository.upsert(buildMetrics());

    let caughtError: unknown;
    try {
      await db.collection<FraudDepartmentMetricsDocument>('fraud_department_metrics').insertOne({
        _id: new ObjectId(),
        organization_id: new ObjectId(oid('org-1')),
        fecha: '2026-09-09',
        casos_abiertos: 9,
        casos_cerrados: 9,
        sla_compliance_pct: null,
        precision_modelo: null,
        false_positive_rate: null,
        created_at: toDate(NOW),
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(extractDuplicateKeyIndexName(caughtError)).toBe('fraud_department_metrics_org_fecha_unique');
  });

  it('a different fecha for the same organization does not collide with the unique index', async () => {
    await repository.upsert(buildMetrics());
    await repository.upsert(buildMetrics({ fecha: '2026-09-10' }));

    const documents = await db
      .collection<FraudDepartmentMetricsDocument>('fraud_department_metrics')
      .find({ organization_id: new ObjectId(oid('org-1')) })
      .toArray();

    expect(documents).toHaveLength(2);
  });
});
