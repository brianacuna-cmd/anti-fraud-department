import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CustomerWebhookSubscription } from '../domain/model/aggregates/CustomerWebhookSubscription.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CustomerWebhookSubscriptionRepository } from '../domain/ports/CustomerWebhookSubscriptionRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createCustomerWebhookSubscriptionId } from '../domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { createWebhookTicketEventType } from '../domain/model/value-objects/WebhookTicketEventType.js';
import {
  webhookSubscriptionNotFound,
  webhookSubscriptionUrlTaken,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface UpdateWebhookSubscriptionInput {
  readonly auth: AuthContext;
  readonly subscriptionId: string;
  readonly url?: string;
  readonly eventTypes?: readonly string[];
  readonly active?: boolean;
}

export interface UpdateWebhookSubscriptionDeps {
  readonly subscriptions: CustomerWebhookSubscriptionRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * SUPERVISOR-only patch of url, eventTypes, and/or active. Cross-tenant
 * hides as NOT_FOUND. Deactivate is UPDATE, not DELETE.
 */
export function createUpdateWebhookSubscriptionUseCase(deps: UpdateWebhookSubscriptionDeps) {
  return async function updateWebhookSubscription(
    input: UpdateWebhookSubscriptionInput,
  ): Promise<CustomerWebhookSubscription> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const subscriptionId = createCustomerWebhookSubscriptionId(input.subscriptionId);
    const eventTypes =
      input.eventTypes === undefined ? undefined : input.eventTypes.map(createWebhookTicketEventType);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.subscriptions.findById(subscriptionId, tx);
      if (existing === null || existing.organizationId !== organizationId) {
        throw webhookSubscriptionNotFound(input.subscriptionId);
      }

      if (input.url !== undefined && input.url !== existing.url) {
        const urlConflict = await deps.subscriptions.findByUrlForOrg(organizationId, input.url, tx);
        if (urlConflict !== null) {
          throw webhookSubscriptionUrlTaken(input.url);
        }
      }

      const now = deps.clock.now();
      const updated = existing.update(
        {
          url: input.url,
          eventTypes,
          active: input.active,
        },
        now,
      );
      await deps.subscriptions.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_WEBHOOK_SUBSCRIPTION',
          resource: 'webhook_subscription',
          resourceId: String(updated.id),
          detail: {
            url: updated.url,
            eventTypes: [...updated.eventTypes],
            active: updated.active,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
