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
import { ANCHOR, activity, contextScenario, hoursBefore, windowScenario } from '../../helpers/risk-assessment/paymentActivityFixtures.js';
import { summarizeMerchantActivity } from '../../../src/modules/risk-assessment/domain/model/MerchantRisk.js';
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

    it('counts the event link and seller exactly like the domain reference implementation', async () => {
      const repository = new MongoPaymentActivityRepository(db);
      const { rows, expected } = contextScenario();
      for (const row of rows) await repository.record(row);

      expect(
        await repository.summarizePaymentContext(oid('org-1'), { paymentLinkReference: 'pi_link', merchantId: 'acct_seller' }, ANCHOR),
      ).toEqual(expected);
      expect(
        await repository.summarizePaymentContext(oid('org-2'), { paymentLinkReference: 'pi_link', merchantId: 'acct_seller' }, ANCHOR),
      ).toEqual({ linkSuspiciousDeclines: 0, linkDistinctCards: 0, merchantLinksWithRepeatedFailures: 0 });
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

  describe('merchant summary and references', () => {
    it('summarizes payments received by any id of the merchant like the reference implementation', async () => {
      const repository = new MongoPaymentActivityRepository(db);
      const rows = [
        activity({ merchantId: 'acct_1', occurredAt: hoursBefore(1), customerId: 'a' }),
        activity({ merchantId: '42', occurredAt: hoursBefore(2), customerId: 'b', outcome: 'FAILED', declineCategory: 'AUTHENTICATION_FAILED' }),
        activity({ merchantId: 'acct_1', occurredAt: hoursBefore(3), kind: 'CHARGEBACK', outcome: null, customerId: 'a' }),
        activity({ merchantId: 'acct_1', occurredAt: hoursBefore(4), kind: 'FRAUD_WARNING', outcome: null, customerId: 'c' }),
        activity({ merchantId: 'acct_1', occurredAt: hoursBefore(24 * 91) }),
        activity({ merchantId: 'acct_other', occurredAt: hoursBefore(1) }),
        activity({ merchantId: null, occurredAt: hoursBefore(1) }),
      ];
      for (const row of rows) await repository.record(row);

      const expected = summarizeMerchantActivity(
        rows.map((r) => r.toProps()).filter((p) => p.merchantId === 'acct_1' || p.merchantId === '42'),
        ANCHOR,
      );
      expect(await repository.summarizeMerchant(oid('org-1'), ['42', 'acct_1'], ANCHOR)).toEqual(expected);
      expect(expected).toMatchObject({ attempts90d: 2, failed90d: 1, chargebacks90d: 1, fraudWarnings90d: 1, distinctCustomers90d: 3 });
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

    it('also counts the cases filed under the other ids of the same person', async () => {
      await insertCase({ customer_id: '42' });
      await insertCase({ bridge_user_id: 'bridge-uuid-42', status: 'RESOLVED', resolution_outcome: 'FRAUD_CONFIRMED' });
      await insertCase({ customer_id: 'someone-else' });

      const history = await new MongoCustomerCaseHistoryReader(db).countByCustomer({
        organizationId: oid('org-1'),
        customerId: 'bridge-uuid-42',
        alsoKnownAs: ['bridge-uuid-42', '42', 'cus_42'],
      });

      expect(history).toEqual({ previousCases: 2, openCases: 1, fraudConfirmedCases: 1, falsePositiveCases: 0 });
    });
  });
});
