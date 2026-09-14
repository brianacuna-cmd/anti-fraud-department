import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import {
  MongoPaymentActivityRepository,
  PAYMENT_ACTIVITIES_COLLECTION,
} from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoPaymentActivityRepository.js';
import { MongoCustomerCaseHistoryReader } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCustomerCaseHistoryReader.js';
import { ANCHOR, activity, windowScenario } from '../../helpers/risk-assessment/paymentActivityFixtures.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

describe('payment activity read models (integration, real replica-set Mongo)', () => {
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
    await db.collection(PAYMENT_ACTIVITIES_COLLECTION).deleteMany({});
    await db.collection('cases').deleteMany({});
  });

  describe('MongoPaymentActivityRepository', () => {
    it('summarizes exactly like the domain reference implementation', async () => {
      const repository = new MongoPaymentActivityRepository(db);
      const { rows, expected } = windowScenario();
      for (const row of rows) await repository.record(row);

      expect(await repository.summarize(oid('org-1'), ['cus_1'], ANCHOR)).toEqual(expected);
    });

    it('merges several ids of the same customer and never crosses tenants', async () => {
      const repository = new MongoPaymentActivityRepository(db);
      await repository.record(activity({ customerId: 'cus_1' }));
      await repository.record(activity({ customerId: '9876' }));
      await repository.record(activity({ customerId: 'cus_1', organizationId: oid('org-2') }));

      const summary = await repository.summarize(oid('org-1'), ['cus_1', '9876'], ANCHOR);

      expect(summary.attempts24h).toBe(2);
      expect(await repository.listRecent(oid('org-1'), ['cus_1', '9876'], 10)).toHaveLength(2);
    });

    it('reports a redelivered event as duplicate and finds a charge owner by reference', async () => {
      const repository = new MongoPaymentActivityRepository(db);
      const row = activity({ providerEventId: 'evt_same', providerReference: 'ch_owner' });

      expect(await repository.record(row)).toBe('inserted');
      expect(await repository.record(activity({ providerEventId: 'evt_same' }))).toBe('duplicate');
      expect(await repository.findCustomerByProviderReference(oid('org-1'), 'stripe', 'ch_owner')).toBe('cus_1');
      expect(await repository.findCustomerByProviderReference(oid('org-2'), 'stripe', 'ch_owner')).toBeNull();
    });
  });

  describe('MongoCustomerCaseHistoryReader', () => {
    async function insertCase(overrides: Record<string, unknown>): Promise<ObjectId> {
      const _id = new ObjectId();
      await db.collection('cases').insertOne({
        _id,
        organization_id: new ObjectId(oid('org-1')),
        customer_id: 'finturu-1',
        stripe_customer_id: null,
        bridge_user_id: null,
        status: 'OPEN',
        resolution_outcome: null,
        deleted_at: null,
        ...overrides,
      });
      return _id;
    }

    it('counts by any of the customer ids, by state and outcome, excluding deleted and the current case', async () => {
      const current = await insertCase({ stripe_customer_id: 'cus_1' });
      await insertCase({ stripe_customer_id: 'cus_1', status: 'PENDING_DOCUMENTATION' });
      await insertCase({ customer_id: 'cus_1', status: 'RESOLVED', resolution_outcome: 'FRAUD_CONFIRMED' });
      await insertCase({ customer_id: 'cus_1', status: 'ARCHIVED', resolution_outcome: 'FALSE_POSITIVE' });
      await insertCase({ customer_id: 'cus_1', status: 'RESOLVED' });
      await insertCase({ customer_id: 'cus_1', deleted_at: new Date() });
      await insertCase({ customer_id: 'cus_1', organization_id: new ObjectId(oid('org-2')) });

      const reader = new MongoCustomerCaseHistoryReader(db);
      const history = await reader.countByCustomer({
        organizationId: oid('org-1'),
        customerId: 'cus_1',
        excludeCaseId: current.toHexString(),
      });

      expect(history).toEqual({ previousCases: 4, openCases: 1, fraudConfirmedCases: 1, falsePositiveCases: 1 });
      expect(await reader.countByCustomer({ organizationId: oid('org-1'), customerId: 'nobody' })).toEqual({
        previousCases: 0,
        openCases: 0,
        fraudConfirmedCases: 0,
        falsePositiveCases: 0,
      });
    });
  });
});
