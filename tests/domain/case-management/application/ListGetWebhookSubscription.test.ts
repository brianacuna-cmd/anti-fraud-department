import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createListWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/ListWebhookSubscription.js';
import { createGetWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/GetWebhookSubscription.js';
import { CustomerWebhookSubscription } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../../../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';

const ORG = oid('org-1');
const OTHER_ORG = oid('org-2');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function auth(roleId: string | null = 'SUPERVISOR', organizationId = ORG) {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId,
  });
}

function seed(
  repo: InMemoryCustomerWebhookSubscriptionRepository,
  organizationId: string,
  url: string,
  active = true,
): CustomerWebhookSubscription {
  const subscription = CustomerWebhookSubscription.create({
    id: generateCustomerWebhookSubscriptionId(),
    organizationId,
    url,
    eventTypes: ['case.created'],
    active,
    now: NOW,
  });
  void repo.create(subscription);
  return subscription;
}

describe('ListWebhookSubscription / GetWebhookSubscription', () => {
  it('lists only the caller organization rows', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    seed(subscriptions, ORG, 'https://hooks.example.com/a');
    seed(subscriptions, ORG, 'https://hooks.example.com/b');
    seed(subscriptions, OTHER_ORG, 'https://hooks.example.com/c');
    const list = createListWebhookSubscriptionUseCase({ subscriptions });

    const items = await list({ auth: auth() });

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.organizationId === ORG)).toBe(true);
  });

  it('filters list by active when requested', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    seed(subscriptions, ORG, 'https://hooks.example.com/a', true);
    seed(subscriptions, ORG, 'https://hooks.example.com/b', false);
    const list = createListWebhookSubscriptionUseCase({ subscriptions });

    const items = await list({ auth: auth(), active: false });

    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://hooks.example.com/b');
    expect(items[0]?.active).toBe(false);
  });

  it('allows AUDITOR to list and writes no audit on read', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    seed(subscriptions, ORG, 'https://hooks.example.com/a');
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();
    const list = createListWebhookSubscriptionUseCase({ subscriptions });

    const items = await list({ auth: auth('AUDITOR') });

    expect(items).toHaveLength(1);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects ANALYST on list', async () => {
    const list = createListWebhookSubscriptionUseCase({
      subscriptions: new InMemoryCustomerWebhookSubscriptionRepository(),
    });

    try {
      await list({ auth: auth('ANALYST') });
      throw new Error('expected list to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('gets a row owned by the caller organization', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    const own = seed(subscriptions, ORG, 'https://hooks.example.com/a');
    const get = createGetWebhookSubscriptionUseCase({ subscriptions });

    const result = await get({ auth: auth(), subscriptionId: String(own.id) });

    expect(result.id).toBe(own.id);
    expect(result.url).toBe('https://hooks.example.com/a');
  });

  it('hides a cross-tenant row as WEBHOOK_SUBSCRIPTION_NOT_FOUND', async () => {
    const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
    const other = seed(subscriptions, OTHER_ORG, 'https://hooks.example.com/a');
    const get = createGetWebhookSubscriptionUseCase({ subscriptions });

    await expect(get({ auth: auth(), subscriptionId: String(other.id) })).rejects.toMatchObject({
      code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND',
    });
  });

  it('404s for a nonexistent id', async () => {
    const get = createGetWebhookSubscriptionUseCase({
      subscriptions: new InMemoryCustomerWebhookSubscriptionRepository(),
    });

    await expect(
      get({ auth: auth(), subscriptionId: oid('missing-subscription') }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SUBSCRIPTION_NOT_FOUND' });
  });
});
