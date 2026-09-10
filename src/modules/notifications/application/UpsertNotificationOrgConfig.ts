import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { NotificationOrgConfigRepository } from '../domain/ports/NotificationOrgConfigRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { NotificationOrgConfig } from '../domain/model/aggregates/NotificationOrgConfig.js';
import { generateNotificationOrgConfigId } from '../domain/model/value-objects/NotificationOrgConfigId.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface UpsertNotificationOrgConfigInput {
  readonly auth: AuthContext;
  /** `undefined` = keep current value, `null` = clear. */
  readonly webhookUrl?: string | null;
  readonly secret?: string | null;
}

export interface UpsertNotificationOrgConfigDeps {
  readonly repository: NotificationOrgConfigRepository;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
}

/**
 * Idempotent per-tenant singleton write (spec Req 1), gated by
 * `SUPERVISION_ROLES` (ADR-5). Mirrors `UpsertOrganizationFraudConfig`:
 * role + tenant checks stay OUTSIDE the transaction; find/upsert/audit share
 * one `tx`.
 */
export function createUpsertNotificationOrgConfigUseCase(deps: UpsertNotificationOrgConfigDeps) {
  return async function upsertNotificationOrgConfig(
    input: UpsertNotificationOrgConfigInput,
  ): Promise<NotificationOrgConfig> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = createOrganizationId(requireTenantContext(input.auth));

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();
      const existing = await deps.repository.findByOrganization(organizationId, tx);
      const desired = existing
        ? existing.update({ webhookUrl: input.webhookUrl, secret: input.secret }, now)
        : NotificationOrgConfig.create({
            id: generateNotificationOrgConfigId(),
            organizationId,
            webhookUrl: input.webhookUrl,
            secret: input.secret,
            now,
          });

      await deps.repository.upsert(desired, tx);
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'NOTIFICATION_ORG_CONFIG_UPDATED',
          resource: 'notificationOrgConfig',
          resourceId: String(desired.id),
          detail: {
            webhookUrlSet: desired.webhookUrl !== null,
            secretSet: desired.secret !== null,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
      return desired;
    });
  };
}
