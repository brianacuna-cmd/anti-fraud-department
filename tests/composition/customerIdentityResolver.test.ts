import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../src/shared/persistence/mongo/ensureIndexes.js';
import {
  CUSTOMER_IDENTITY_LINKS_COLLECTION,
  IDENTITY_TTL_MS,
  createCustomerIdentityResolver,
  queryFor,
} from '../../src/composition/customerIdentityResolver.js';
import {
  FinturuUnavailableError,
  type FinturuIdentityDto,
  type FinturuIdentityQuery,
} from '../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { startReplicaSetMongo } from '../helpers/mongoTestServer.js';
import { oid } from '../support/oid.js';

jest.setTimeout(120_000);

const ORG = oid('org-1');
const ANA: FinturuIdentityDto = {
  userId: 42,
  email: 'ana@tienda.co',
  bridgeCustomerId: 'b1a2c3d4-bridge',
  stripeAccountId: 'acct_ana',
  stripeCustomerId: 'cus_ana',
};

describe('createCustomerIdentityResolver (real Mongo cache)', () => {
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
    await db.collection(CUSTOMER_IDENTITY_LINKS_COLLECTION).deleteMany({});
  });

  function build(answer: (query: FinturuIdentityQuery) => Promise<FinturuIdentityDto | null>, now = new Date('2026-09-15T10:00:00Z')) {
    const queries: FinturuIdentityQuery[] = [];
    const errors: unknown[] = [];
    const clock = { now: () => fromDate(now) };
    const resolve = createCustomerIdentityResolver({
      finturu: {
        getIdentity: async (query) => {
          queries.push(query);
          return { identity: await answer(query) };
        },
      },
      db,
      clock,
      onError: (error) => errors.push(error),
    });
    return { resolve, queries, errors };
  }

  it('asks by the right kind of id and returns every id of the person', () => {
    expect(queryFor('acct_1')).toEqual({ stripeAccountId: 'acct_1' });
    expect(queryFor('cus_1')).toEqual({ stripeCustomerId: 'cus_1' });
    expect(queryFor('42')).toEqual({ userId: 42 });
    expect(queryFor('b1a2c3d4-bridge')).toEqual({ bridgeCustomerId: 'b1a2c3d4-bridge' });
  });

  it('resolves once and then answers any id of the same person from the cache', async () => {
    const { resolve, queries } = build(async () => ANA);

    const fromBridge = await resolve(ORG, 'b1a2c3d4-bridge');
    const fromBridgeAgain = await resolve(ORG, 'b1a2c3d4-bridge');

    expect(fromBridge).toEqual(['b1a2c3d4-bridge', '42', 'acct_ana', 'cus_ana']);
    expect(fromBridgeAgain).toEqual(fromBridge);
    expect(queries).toEqual([{ bridgeCustomerId: 'b1a2c3d4-bridge' }]);
    // Another id of Ana is already linked: no second call to Finturu.
    expect(await resolve(ORG, 'cus_ana')).toEqual(fromBridge);
    expect(queries).toHaveLength(1);
  });

  it('caches an unknown id as itself, and asks again once the link expires', async () => {
    const first = build(async () => null);
    expect(await first.resolve(ORG, 'cus_nobody')).toEqual(['cus_nobody']);

    const later = build(async () => ANA, new Date(Date.parse('2026-09-15T10:00:00Z') + IDENTITY_TTL_MS + 1));
    expect(await later.resolve(ORG, 'cus_nobody')).toContain('42');
    expect(later.queries).toHaveLength(1);
  });

  it('falls back to the single id without caching when Finturu is down', async () => {
    const down = build(async () => {
      throw new FinturuUnavailableError('/identity', 502);
    });

    expect(await down.resolve(ORG, '42')).toEqual(['42']);
    expect(down.errors).toHaveLength(1);
    expect(await db.collection(CUSTOMER_IDENTITY_LINKS_COLLECTION).countDocuments()).toBe(0);
  });

  it('keeps organizations apart', async () => {
    const { resolve, queries } = build(async () => ANA);
    await resolve(ORG, '42');
    await resolve(oid('org-2'), '42');

    expect(queries).toHaveLength(2);
  });
});
