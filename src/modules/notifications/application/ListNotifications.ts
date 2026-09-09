import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { NotificationPage, NotificationRepository } from '../domain/ports/NotificationRepository.js';
import type { NotificationStatus } from '../domain/model/value-objects/NotificationStatus.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListNotificationsInput {
  readonly auth: AuthContext;
  readonly status?: NotificationStatus;
  readonly limit: number;
  readonly offset: number;
}

export interface ListNotificationsDeps {
  readonly repository: NotificationRepository;
}

/**
 * Self-scoped, paginated inbox list (R3, design D8). `recipientUserId` is
 * derived exclusively from `AuthContext.userId` — no route/query param ever
 * substitutes another user's id, so a caller can never list another user's
 * notifications. Read-only, no transaction.
 */
export function createListNotificationsUseCase(deps: ListNotificationsDeps) {
  return async function listNotifications(input: ListNotificationsInput): Promise<NotificationPage> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const recipientUserId = createUserId(input.auth.userId);

    return deps.repository.findByRecipient(organizationId, recipientUserId, {
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
