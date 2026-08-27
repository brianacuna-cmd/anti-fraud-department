import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CustomerWebhookSubscription } from '../domain/model/aggregates/CustomerWebhookSubscription.js';
import type { CustomerWebhookSubscriptionRepository } from '../domain/ports/CustomerWebhookSubscriptionRepository.js';
import { createCustomerWebhookSubscriptionId } from '../domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { webhookSubscriptionNotFound } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireReadRole, OVERSIGHT_READ_ROLES } from './authorization/policy.js';

export interface GetWebhookSubscriptionInput {
  readonly auth: AuthContext;
  readonly subscriptionId: string;
}

export interface GetWebhookSubscriptionDeps {
  readonly subscriptions: CustomerWebhookSubscriptionRepository;
}

/**
 * Get by id, limited to the caller org. Cross-tenant and missing ids both
 * throw WEBHOOK_SUBSCRIPTION_NOT_FOUND so existence is not leaked.
 */
export function createGetWebhookSubscriptionUseCase(deps: GetWebhookSubscriptionDeps) {
  return async function getWebhookSubscription(
    input: GetWebhookSubscriptionInput,
  ): Promise<CustomerWebhookSubscription> {
    requireReadRole(input.auth, OVERSIGHT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const subscriptionId = createCustomerWebhookSubscriptionId(input.subscriptionId);
    const subscription = await deps.subscriptions.findById(subscriptionId);
    if (subscription === null || subscription.organizationId !== organizationId) {
      throw webhookSubscriptionNotFound(input.subscriptionId);
    }
    return subscription;
  };
}
