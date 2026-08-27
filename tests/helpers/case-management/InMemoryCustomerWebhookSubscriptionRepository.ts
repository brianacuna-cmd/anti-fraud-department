import type { CustomerWebhookSubscription } from '../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import type { CustomerWebhookSubscriptionId } from '../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import type { CustomerWebhookSubscriptionRepository } from '../../../src/modules/case-management/domain/ports/CustomerWebhookSubscriptionRepository.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';
import { webhookSubscriptionUrlTaken } from '../../../src/modules/case-management/domain/errors/CaseManagementError.js';

/**
 * In-memory `CustomerWebhookSubscriptionRepository` fake. Unique
 * `(organizationId, url)` matches the Mongo unique index, including inactive
 * rows. Hard delete removes the row so the URL can be reused.
 */
export class InMemoryCustomerWebhookSubscriptionRepository implements CustomerWebhookSubscriptionRepository {
  private readonly byId = new Map<string, CustomerWebhookSubscription>();

  async create(subscription: CustomerWebhookSubscription, _tx?: Transaction): Promise<void> {
    this.assertUrlAvailable(subscription);
    this.byId.set(String(subscription.id), subscription);
  }

  async save(subscription: CustomerWebhookSubscription, _tx?: Transaction): Promise<void> {
    this.assertUrlAvailable(subscription);
    this.byId.set(String(subscription.id), subscription);
  }

  async delete(id: CustomerWebhookSubscriptionId, _tx?: Transaction): Promise<void> {
    this.byId.delete(String(id));
  }

  async findById(
    id: CustomerWebhookSubscriptionId,
    _tx?: Transaction,
  ): Promise<CustomerWebhookSubscription | null> {
    return this.byId.get(String(id)) ?? null;
  }

  async findByUrlForOrg(
    organizationId: string,
    url: string,
    _tx?: Transaction,
  ): Promise<CustomerWebhookSubscription | null> {
    return (
      [...this.byId.values()].find(
        (subscription) => subscription.organizationId === organizationId && subscription.url === url,
      ) ?? null
    );
  }

  async listByOrganization(
    organizationId: string,
    filter?: { readonly active?: boolean },
    _tx?: Transaction,
  ): Promise<readonly CustomerWebhookSubscription[]> {
    return [...this.byId.values()]
      .filter((subscription) => subscription.organizationId === organizationId)
      .filter((subscription) => filter?.active === undefined || subscription.active === filter.active)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  all(): CustomerWebhookSubscription[] {
    return [...this.byId.values()];
  }

  private assertUrlAvailable(subscription: CustomerWebhookSubscription): void {
    const taken = [...this.byId.values()].find(
      (existing) =>
        existing.id !== subscription.id &&
        existing.organizationId === subscription.organizationId &&
        existing.url === subscription.url,
    );
    if (taken !== undefined) {
      throw webhookSubscriptionUrlTaken(subscription.url);
    }
  }
}
