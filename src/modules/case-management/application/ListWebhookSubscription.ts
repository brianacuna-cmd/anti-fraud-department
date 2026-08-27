import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CustomerWebhookSubscription } from '../domain/model/aggregates/CustomerWebhookSubscription.js';
import type { CustomerWebhookSubscriptionRepository } from '../domain/ports/CustomerWebhookSubscriptionRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireReadRole, OVERSIGHT_READ_ROLES } from './authorization/policy.js';

export interface ListWebhookSubscriptionInput {
  readonly auth: AuthContext;
  readonly active?: boolean;
}

export interface ListWebhookSubscriptionDeps {
  readonly subscriptions: CustomerWebhookSubscriptionRepository;
}

/** Tenant-scoped catalog list. OVERSIGHT_READ_ROLES; no audit. */
export function createListWebhookSubscriptionUseCase(deps: ListWebhookSubscriptionDeps) {
  return async function listWebhookSubscription(
    input: ListWebhookSubscriptionInput,
  ): Promise<readonly CustomerWebhookSubscription[]> {
    requireReadRole(input.auth, OVERSIGHT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    return deps.subscriptions.listByOrganization(
      organizationId,
      input.active === undefined ? undefined : { active: input.active },
    );
  };
}
