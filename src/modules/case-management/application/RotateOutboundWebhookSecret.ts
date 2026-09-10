import { randomBytes } from 'node:crypto';
import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import {
  OrganizationFraudConfig,
  WEBHOOK_SECRET_GRACE_HOURS,
} from '../domain/model/aggregates/OrganizationFraudConfig.js';
import { organizationFraudConfigNotFound } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface RotateOutboundWebhookSecretInput {
  readonly auth: AuthContext;
  readonly gracePeriodHours?: number;
}

export interface RotateOutboundWebhookSecretDeps {
  readonly repository: OrganizationFraudConfigRepository;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly generateSecret?: () => string;
}

function mintSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * SUPERVISOR rotate: copy current→previous, mint a new current secret, start grace.
 * Audit and HTTP never include secret bytes.
 */
export function createRotateOutboundWebhookSecretUseCase(deps: RotateOutboundWebhookSecretDeps) {
  const generateSecret = deps.generateSecret ?? mintSecret;
  return async function rotateOutboundWebhookSecret(
    input: RotateOutboundWebhookSecretInput,
  ): Promise<OrganizationFraudConfig> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const gracePeriodHours = input.gracePeriodHours ?? WEBHOOK_SECRET_GRACE_HOURS.default;

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.repository.findByOrganization(organizationId, tx);
      if (existing === null) {
        throw organizationFraudConfigNotFound(organizationId);
      }
      const rotated = existing.rotateOutboundWebhookSecret(
        generateSecret(),
        gracePeriodHours,
        deps.clock.now(),
      );
      await deps.repository.upsert(rotated, tx);
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'ROTATE_WEBHOOK_SECRET',
          resource: 'organization_fraud_config',
          resourceId: String(rotated.id),
          detail: {
            gracePeriodHours,
            graceExpiresAt: rotated.outboundWebhookSecretGraceExpiresAt,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
      return rotated;
    });
  };
}
