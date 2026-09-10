import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { NotificationRepository } from '../domain/ports/NotificationRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';

export interface MarkAllNotificationsReadInput {
  readonly auth: AuthContext;
}

export interface MarkAllNotificationsReadResult {
  readonly updatedCount: number;
}

export interface MarkAllNotificationsReadDeps {
  readonly repository: NotificationRepository;
  readonly clock: Clock;
}

/**
 * R1/R2/design D4 use case: self-scoped bulk mark-all-read. Both
 * `organizationId` and `recipientUserId` are derived exclusively from
 * `AuthContext` — never a request parameter — so cross-tenant/cross-user
 * leakage is structurally impossible. Simple `tx?` passthrough, no
 * UnitOfWork (mirrors `MarkNotificationRead`).
 */
export function createMarkAllNotificationsReadUseCase(deps: MarkAllNotificationsReadDeps) {
  return async function markAllNotificationsRead(
    input: MarkAllNotificationsReadInput,
    tx?: Transaction,
  ): Promise<MarkAllNotificationsReadResult> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const recipientUserId = createUserId(input.auth.userId);
    const updatedCount = await deps.repository.markAllReadForRecipient(
      organizationId,
      recipientUserId,
      deps.clock.now(),
      tx,
    );
    return { updatedCount };
  };
}
