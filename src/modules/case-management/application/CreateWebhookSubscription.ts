import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CustomerWebhookSubscription } from '../domain/model/aggregates/CustomerWebhookSubscription.js';
import { CustomerWebhookSubscription as CustomerWebhookSubscriptionAggregate } from '../domain/model/aggregates/CustomerWebhookSubscription.js';
import type { CustomerWebhookSubscriptionId } from '../domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { createWebhookTicketEventType } from '../domain/model/value-objects/WebhookTicketEventType.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CustomerWebhookSubscriptionRepository } from '../domain/ports/CustomerWebhookSubscriptionRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { webhookSubscriptionUrlTaken } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface CreateWebhookSubscriptionInput {
  readonly auth: AuthContext;
  readonly url: string;
  readonly eventTypes: readonly string[];
  readonly active?: boolean;
}

export interface CreateWebhookSubscriptionDeps {
  readonly subscriptions: CustomerWebhookSubscriptionRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCustomerWebhookSubscriptionId: () => CustomerWebhookSubscriptionId;
}

/**
 * SUPERVISOR-only catalog create. Unique `(organizationId, url)` is checked
 * inside the same UnitOfWork as the insert + CREATE audit, mirroring
 * CreateRoutingRule / CreateWatchlist.
 */
export function createCreateWebhookSubscriptionUseCase(deps: CreateWebhookSubscriptionDeps) {
  return async function createWebhookSubscription(
    input: CreateWebhookSubscriptionInput,
  ): Promise<CustomerWebhookSubscription> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const eventTypes = input.eventTypes.map(createWebhookTicketEventType);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.subscriptions.findByUrlForOrg(organizationId, input.url, tx);
      if (existing !== null) {
        throw webhookSubscriptionUrlTaken(input.url);
      }

      const now = deps.clock.now();
      const subscription = CustomerWebhookSubscriptionAggregate.create({
        id: deps.generateCustomerWebhookSubscriptionId(),
        organizationId,
        url: input.url,
        eventTypes,
        active: input.active,
        now,
      });
      await deps.subscriptions.create(subscription, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'CREATE_WEBHOOK_SUBSCRIPTION',
          resource: 'webhook_subscription',
          resourceId: String(subscription.id),
          detail: {
            url: subscription.url,
            eventTypes: [...subscription.eventTypes],
            active: subscription.active,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return subscription;
    });
  };
}
