import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCustomerWebhookSubscriptionRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCustomerWebhookSubscriptionRepository.js';
import { CustomerWebhookSubscription } from '../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildSubscription(
  overrides: {
    organizationId?: string;
    url?: string;
    active?: boolean;
    now?: ReturnType<typeof fromDate>;
  } = {},
): CustomerWebhookSubscription {
  return CustomerWebhookSubscription.create({
    id: generateCustomerWebhookSubscriptionId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    url: overrides.url ?? 'https://hooks.example.com/notify',
    eventTypes: ['case.created'],
    active: overrides.active,
    now: overrides.now ?? NOW,
  });
}

describe('MongoCustomerWebhookSubscriptionRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoCustomerWebhookSubscriptionRepository;

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
    repository = new MongoCustomerWebhookSubscriptionRepository(db);
  });

  afterEach(async () => {
    await db.collection('customer_webhook_subscriptions').deleteMany({});
  });

  it('persists multiple destinations per organization when URLs differ', async () => {
    const first = buildSubscription({ url: 'https://hooks.example.com/a', now: NOW });
    const second = buildSubscription({
      url: 'https://hooks.example.com/b',
      now: fromDate(new Date('2026-01-02T00:00:00.000Z')),
    });
    const otherOrg = buildSubscription({
      organizationId: oid('org-2'),
      url: 'https://hooks.example.com/a',
    });

    await repository.create(first);
    await repository.create(second);
    await repository.create(otherOrg);

    const listed = await repository.listByOrganization(oid('org-1'));
    expect(listed.map((row) => row.url)).toEqual([
      'https://hooks.example.com/a',
      'https://hooks.example.com/b',
    ]);
  });

  it('translates a unique (organization_id, url) collision into WEBHOOK_SUBSCRIPTION_URL_TAKEN, including inactive rows', async () => {
    const active = buildSubscription({ url: 'https://hooks.example.com/dup' });
    await repository.create(active);
    await repository.save(active.update({ active: false }, LATER));

    await expect(
      repository.create(buildSubscription({ url: 'https://hooks.example.com/dup' })),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SUBSCRIPTION_URL_TAKEN' });
  });

  it('hard-deletes a catalog row so the URL can be reused', async () => {
    const subscription = buildSubscription({ url: 'https://hooks.example.com/gone' });
    await repository.create(subscription);

    await repository.delete(subscription.id);

    expect(await repository.findById(subscription.id)).toBeNull();
    await expect(
      repository.create(buildSubscription({ url: 'https://hooks.example.com/gone' })),
    ).resolves.toBeUndefined();
  });

  it('keeps an inactive row stored and findable', async () => {
    const subscription = buildSubscription();
    await repository.create(subscription);
    await repository.save(subscription.update({ active: false }, LATER));

    const found = await repository.findById(subscription.id);
    expect(found).not.toBeNull();
    expect(found?.active).toBe(false);
    expect(found?.url).toBe('https://hooks.example.com/notify');

    const listedInactive = await repository.listByOrganization(oid('org-1'), { active: false });
    expect(listedInactive).toHaveLength(1);
    expect(listedInactive[0]?.id).toBe(subscription.id);

    const listedActive = await repository.listByOrganization(oid('org-1'), { active: true });
    expect(listedActive).toEqual([]);
  });

  it('findByUrlForOrg returns the match scoped to the organization, including inactive', async () => {
    const subscription = buildSubscription({
      organizationId: oid('org-1'),
      url: 'https://hooks.example.com/lookup',
    });
    await repository.create(subscription);
    await repository.save(subscription.update({ active: false }, LATER));

    const found = await repository.findByUrlForOrg(oid('org-1'), 'https://hooks.example.com/lookup');
    expect(found?.id).toBe(subscription.id);
    expect(found?.active).toBe(false);

    expect(await repository.findByUrlForOrg(oid('org-2'), 'https://hooks.example.com/lookup')).toBeNull();
  });

  it('create / findById round-trips event types and timestamps', async () => {
    const subscription = CustomerWebhookSubscription.create({
      id: generateCustomerWebhookSubscriptionId(),
      organizationId: oid('org-1'),
      url: 'https://hooks.example.com/round-trip',
      eventTypes: ['case.created', 'aml.alert_generated'],
      now: NOW,
    });

    await repository.create(subscription);
    const found = await repository.findById(subscription.id);

    expect(found?.id).toBe(subscription.id);
    expect(found?.organizationId).toBe(oid('org-1'));
    expect(found?.url).toBe('https://hooks.example.com/round-trip');
    expect(found?.eventTypes).toEqual(['case.created', 'aml.alert_generated']);
    expect(found?.active).toBe(true);
    expect(found?.createdAt).toBe(NOW);
  });
});
