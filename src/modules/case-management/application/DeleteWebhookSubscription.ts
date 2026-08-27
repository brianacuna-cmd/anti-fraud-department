import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CustomerWebhookSubscription } from '../domain/model/aggregates/CustomerWebhookSubscription.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CustomerWebhookSubscriptionRepository } from '../domain/ports/CustomerWebhookSubscriptionRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createCustomerWebhookSubscriptionId } from '../domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { webhookSubscriptionNotFound } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface DeleteWebhookSubscriptionInput {
  readonly auth: AuthContext;
  readonly subscriptionId: string;
}

export interface DeleteWebhookSubscriptionDeps {
  readonly subscriptions: CustomerWebhookSubscriptionRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
}

/**
 * SUPERVISOR-only hard delete. Cross-tenant and missing ids both throw
 * WEBHOOK_SUBSCRIPTION_NOT_FOUND. Delete + audit run in one UnitOfWork.
 */
export function createDeleteWebhookSubscriptionUseCase(deps: DeleteWebhookSubscriptionDeps) {
  return async function deleteWebhookSubscription(
    input: DeleteWebhookSubscriptionInput,
  ): Promise<CustomerWebhookSubscription> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const subscriptionId = createCustomerWebhookSubscriptionId(input.subscriptionId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.subscriptions.findById(subscriptionId, tx);
      if (existing === null || existing.organizationId !== organizationId) {
        throw webhookSubscriptionNotFound(input.subscriptionId);
      }

      await deps.subscriptions.delete(subscriptionId, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'DELETE_WEBHOOK_SUBSCRIPTION',
          resource: 'webhook_subscription',
          resourceId: String(existing.id),
          detail: {
            url: existing.url,
            eventTypes: [...existing.eventTypes],
            active: existing.active,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return existing;
    });
  };
}
