import type { CustomerWebhookSubscription } from '../model/aggregates/CustomerWebhookSubscription.js';
import type { CustomerWebhookSubscriptionId } from '../model/value-objects/CustomerWebhookSubscriptionId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `customer_webhook_subscriptions`. Unique
 * `(organizationId, url)` includes inactive rows. Delete is hard.
 */
export interface CustomerWebhookSubscriptionRepository {
  create(subscription: CustomerWebhookSubscription, tx?: Transaction): Promise<void>;
  save(subscription: CustomerWebhookSubscription, tx?: Transaction): Promise<void>;
  delete(id: CustomerWebhookSubscriptionId, tx?: Transaction): Promise<void>;
  findById(id: CustomerWebhookSubscriptionId, tx?: Transaction): Promise<CustomerWebhookSubscription | null>;
  findByUrlForOrg(
    organizationId: string,
    url: string,
    tx?: Transaction,
  ): Promise<CustomerWebhookSubscription | null>;
  listByOrganization(
    organizationId: string,
    filter?: { readonly active?: boolean },
    tx?: Transaction,
  ): Promise<readonly CustomerWebhookSubscription[]>;
}
