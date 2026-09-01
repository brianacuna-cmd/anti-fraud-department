import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
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
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildCase(id: string, organizationId = oid('org-1')): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(42),
    priority: 'HIGH',
    now: NOW,
  });
}


/** Caso con identificadores concretos, para la expansion del grafo (INV-013). */
function buildCaseWithIdentifiers(
  id: string,
  overrides: {
    organizationId?: string;
    customerId?: string;
    customerEmail?: string | null;
    bridgeWallet?: string | null;
    stripeCustomerId?: string | null;
  } = {},
): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId: overrides.organizationId ?? oid('org-1'),
    customerId: overrides.customerId ?? 'customer-1',
    customerEmail: overrides.customerEmail ?? null,
    bridgeWallet: overrides.bridgeWallet ?? null,
    stripeCustomerId: overrides.stripeCustomerId ?? null,
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
    await db.collection('cases').deleteMany({});
  });

  it('persists a case and retrieves it by id, tenant-scoped fields intact', async () => {
    await repository.save(buildCase(oid('case-1')));

    const found = await repository.findById(createCaseId(oid('case-1')));

    expect(found?.organizationId).toBe(oid('org-1'));
    expect(found?.customerId).toBe('customer-1');
    expect(found?.status).toBe('OPEN');
    expect(found?.riskScore).toBe(42);
    expect(found?.priority).toBe('HIGH');
  });

  it('round-trips idempotencyKey (present and null)', async () => {
    const withKey = Case.rehydrate({ ...buildCase(oid('case-idem')).toProps(), idempotencyKey: 'idem-1' });
    await repository.save(withKey);
    await repository.save(buildCase(oid('case-no-idem')));

    const foundWithKey = await repository.findById(createCaseId(oid('case-idem')));
    const foundWithoutKey = await repository.findById(createCaseId(oid('case-no-idem')));

    expect(foundWithKey?.idempotencyKey).toBe('idem-1');
    expect(foundWithoutKey?.idempotencyKey).toBeNull();
  });

  it('findByIdempotencyKey returns the matching Case for (org, key), null for non-matching org/key/null-key', async () => {
    const withKey = Case.rehydrate({ ...buildCase(oid('case-idem-2')).toProps(), idempotencyKey: 'idem-2' });
    await repository.save(withKey);
    await repository.save(buildCase(oid('case-no-idem-2')));

    const found = await repository.findByIdempotencyKey(oid('org-1'), 'idem-2');
    const wrongOrg = await repository.findByIdempotencyKey(oid('org-2'), 'idem-2');
    const wrongKey = await repository.findByIdempotencyKey(oid('org-1'), 'other');
    const nullKeyCase = await repository.findByIdempotencyKey(oid('org-1'), 'idem-2-missing');

    expect(found?.id).toBe(oid('case-idem-2'));
    expect(wrongOrg).toBeNull();
    expect(wrongKey).toBeNull();
    expect(nullKeyCase).toBeNull();
  });

  it('returns null when no case matches the given id', async () => {
    const found = await repository.findById(createCaseId(oid('missing')));

    expect(found).toBeNull();
  });

  it('round-trips a reassigned AssignedTo through the split AssignedTo/AssignedToType columns', async () => {
    const assigned = buildCase(oid('case-2')).reassign(createAssignedTo('ROLE', 'role-1'), NOW);
    await repository.save(assigned);

    const found = await repository.findById(createCaseId(oid('case-2')));

    expect(found?.assignedTo).toEqual({ type: 'ROLE', id: 'role-1' });
  });

  it('participates in a given transaction: save() is rolled back when the transaction aborts', async () => {
    const unitOfWork = new MongoUnitOfWork(client);

    await expect(
      unitOfWork.withTransaction(async (tx) => {
        await repository.save(buildCase(oid('case-tx')), tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const found = await repository.findById(createCaseId(oid('case-tx')));
    expect(found).toBeNull();
  });

  /**
   * Regression guard (inverted by the UUID -> native ObjectId migration):
   * `_id` is now persisted as a driver `ObjectId`, never a plain string.
   */
  it('round-trips the raw document by _id as a native ObjectId', async () => {
    await repository.save(buildCase(oid('case-id-guard')));

    const rawDocument = await db
      .collection<CaseDocument>('cases')
      .findOne({ _id: new ObjectId(oid('case-id-guard')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBeInstanceOf(ObjectId);
    expect(rawDocument?._id.toString()).toBe(oid('case-id-guard'));
  });

  it('list sorts by due_date ASC with nulls last and excludes soft-deleted', async () => {
    const early = fromDate(new Date('2026-01-02T00:00:00.000Z'));
    const late = fromDate(new Date('2026-01-04T00:00:00.000Z'));

    await repository.save(buildCase(oid('list-null')).withDueDate(null, NOW));
    await repository.save(buildCase(oid('list-late')).withDueDate(late, NOW));
    await repository.save(buildCase(oid('list-early')).withDueDate(early, NOW));
    await repository.save(
      Case.rehydrate({
        ...buildCase(oid('list-deleted')).withDueDate(early, NOW).toProps(),
        deletedAt: NOW,
      }),
    );
    await repository.save(buildCase(oid('list-other-org'), oid('org-2')).withDueDate(early, NOW));

    const page = await repository.list({
      organizationId: oid('org-1'),
      limit: 10,
      offset: 0,
    });

    expect(page.total).toBe(3);
    expect(page.items.map((c) => c.id)).toEqual([
      oid('list-early'),
      oid('list-late'),
      oid('list-null'),
    ]);
  });

  it('list filters by status, priority, assignedTo, riskScore, tags, and due range', async () => {
    const mid = fromDate(new Date('2026-01-03T00:00:00.000Z'));
    const early = fromDate(new Date('2026-01-02T00:00:00.000Z'));
    const late = fromDate(new Date('2026-01-04T00:00:00.000Z'));
    const assignee = oid('analyst-list');

    const match = buildCase(oid('list-match'))
      .reassign(createAssignedTo('USER', assignee), NOW)
      .withDueDate(mid, NOW);
    await repository.save(
      Case.rehydrate({
        ...match.toProps(),
        riskScore: createRiskScore(70),
        priority: 'HIGH',
        status: 'OPEN',
        tags: ['fraud', 'wire'],
      }),
    );
    await repository.save(
      Case.rehydrate({
        ...buildCase(oid('list-miss'))
          .reassign(createAssignedTo('USER', assignee), NOW)
          .withDueDate(mid, NOW)
          .toProps(),
        riskScore: createRiskScore(10),
        priority: 'HIGH',
        tags: ['fraud', 'wire'],
      }),
    );

    const page = await repository.list({
      organizationId: oid('org-1'),
      status: ['OPEN'],
      priority: ['HIGH'],
      assignedToId: assignee,
      riskScoreMin: 50,
      riskScoreMax: 80,
      tags: ['fraud', 'wire'],
      dueAfter: early,
      dueBefore: late,
      limit: 10,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(oid('list-match'));
  });

  it('list filters by customer_id equality when customerId is set', async () => {
    await repository.save(buildCaseWithIdentifiers(oid('cust-a-case'), { customerId: 'cust-a' }));
    await repository.save(buildCaseWithIdentifiers(oid('cust-b-case'), { customerId: 'cust-b' }));

    const page = await repository.list({
      organizationId: oid('org-1'),
      customerId: 'cust-a',
      limit: 10,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(oid('cust-a-case'));
    expect(page.items[0]?.customerId).toBe('cust-a');
  });

  describe('findByEntityIdentifiers (INV-013)', () => {
    it('devuelve los expedientes que comparten cualquiera de los identificadores', async () => {
      const withWallet = buildCaseWithIdentifiers(oid('case-w'), { bridgeWallet: '0xabc' });
      const withEmail = buildCaseWithIdentifiers(oid('case-e'), { customerEmail: 'mula@x.com' });
      const unrelated = buildCaseWithIdentifiers(oid('case-u'), { bridgeWallet: '0xotra' });
      await repository.save(withWallet);
      await repository.save(withEmail);
      await repository.save(unrelated);

      const found = await repository.findByEntityIdentifiers({
        organizationId: oid('org-1'),
        refs: [
          { type: 'WALLET', value: '0xabc' },
          { type: 'EMAIL', value: 'mula@x.com' },
        ],
        limit: 50,
      });

      expect(found.map((kase) => kase.id).sort()).toEqual([withEmail.id, withWallet.id].sort());
    });

    it('no cruza inquilinos aunque el identificador sea identico', async () => {
      await repository.save(buildCaseWithIdentifiers(oid('case-mine'), { bridgeWallet: '0xabc' }));
      await repository.save(
        buildCaseWithIdentifiers(oid('case-theirs'), {
          organizationId: oid('org-2'),
          bridgeWallet: '0xabc',
        }),
      );

      const found = await repository.findByEntityIdentifiers({
        organizationId: oid('org-1'),
        refs: [{ type: 'WALLET', value: '0xabc' }],
        limit: 50,
      });

      expect(found).toHaveLength(1);
      expect(found[0]!.organizationId).toBe(oid('org-1'));
    });

    it('excluye los borrados logicamente', async () => {
      const live = buildCaseWithIdentifiers(oid('case-live'), { bridgeWallet: '0xabc' });
      const deleted = buildCaseWithIdentifiers(oid('case-dead'), { bridgeWallet: '0xabc' });
      await repository.save(live);
      await repository.save(deleted);
      await db
        .collection<CaseDocument>('cases')
        .updateOne({ _id: new ObjectId(deleted.id) }, { $set: { deleted_at: new Date() } });

      const found = await repository.findByEntityIdentifiers({
        organizationId: oid('org-1'),
        refs: [{ type: 'WALLET', value: '0xabc' }],
        limit: 50,
      });

      expect(found.map((kase) => kase.id)).toEqual([live.id]);
    });

    it('respeta el limite por ronda', async () => {
      await repository.save(buildCaseWithIdentifiers(oid('case-1'), { bridgeWallet: '0xabc' }));
      await repository.save(buildCaseWithIdentifiers(oid('case-2'), { bridgeWallet: '0xabc' }));
      await repository.save(buildCaseWithIdentifiers(oid('case-3'), { bridgeWallet: '0xabc' }));

      const found = await repository.findByEntityIdentifiers({
        organizationId: oid('org-1'),
        refs: [{ type: 'WALLET', value: '0xabc' }],
        limit: 2,
      });

      expect(found).toHaveLength(2);
    });

    it('devuelve vacio sin identificadores, sin tocar la coleccion', async () => {
      await repository.save(buildCaseWithIdentifiers(oid('case-1'), { bridgeWallet: '0xabc' }));

      // An empty $or is an error in Mongo: without the early cut, expansion
      // would blow up just as the network is exhausted.
      const found = await repository.findByEntityIdentifiers({
        organizationId: oid('org-1'),
        refs: [],
        limit: 50,
      });

      expect(found).toEqual([]);
    });
  });

});
