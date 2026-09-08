import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { OrganizationFraudConfig } from '../domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../domain/model/value-objects/OrganizationFraudConfigId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface UpsertOrganizationFraudConfigInput {
  readonly auth: AuthContext;
  readonly slaLowMinutes: number;
  readonly slaMediumMinutes: number;
  readonly slaHighMinutes: number;
  readonly slaCriticalMinutes: number;
  readonly riskThresholdLow: number;
  readonly riskThresholdMedium: number;
  readonly riskThresholdHigh: number;
  readonly riskThresholdCritical: number;
  readonly featureFlags?: Readonly<Record<string, boolean>>;
  readonly outboundWebhookUrl?: string | null;
  readonly outboundWebhookSecret?: string | null;
}

export interface UpsertOrganizationFraudConfigDeps {
  readonly repository: OrganizationFraudConfigRepository;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
}

function organizationFraudConfigAuditDetail(config: OrganizationFraudConfig): Record<string, unknown> {
  return {
    slaLowMinutes: config.slaLowMinutes,
    slaMediumMinutes: config.slaMediumMinutes,
    slaHighMinutes: config.slaHighMinutes,
    slaCriticalMinutes: config.slaCriticalMinutes,
    riskThresholdLow: config.riskThresholdLow,
    riskThresholdMedium: config.riskThresholdMedium,
    riskThresholdHigh: config.riskThresholdHigh,
    riskThresholdCritical: config.riskThresholdCritical,
    featureFlags: config.featureFlags,
    outboundWebhookUrlSet: config.outboundWebhookUrl !== null,
    outboundWebhookSecretSet: config.outboundWebhookSecret !== null,
  };
}

/**
 * Idempotent per-tenant singleton write (design: "upsert(config, tx?)").
 * Reads the current row (if any) so a re-submission UPDATES it in place —
 * uniqueness is ultimately enforced by `org_fraud_config_unique`, this is
 * just the "no separate read vs create branch leaking into the aggregate"
 * pattern, mirrored from `SetNotificationPreference`.
 *
 * Catalog mutation copies webhook Create/Update: SUPERVISOR + tenant checks
 * stay outside the transaction; find/upsert/audit share one `tx`.
 */
export function createUpsertOrganizationFraudConfigUseCase(deps: UpsertOrganizationFraudConfigDeps) {
  return async function upsertOrganizationFraudConfig(
    input: UpsertOrganizationFraudConfigInput,
  ): Promise<OrganizationFraudConfig> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();
      const existing = await deps.repository.findByOrganization(organizationId, tx);
      const desired = existing
        ? existing.update(
            {
              slaLowMinutes: input.slaLowMinutes,
              slaMediumMinutes: input.slaMediumMinutes,
              slaHighMinutes: input.slaHighMinutes,
              slaCriticalMinutes: input.slaCriticalMinutes,
              riskThresholdLow: input.riskThresholdLow,
              riskThresholdMedium: input.riskThresholdMedium,
              riskThresholdHigh: input.riskThresholdHigh,
              riskThresholdCritical: input.riskThresholdCritical,
              featureFlags: input.featureFlags,
              outboundWebhookUrl: input.outboundWebhookUrl,
              outboundWebhookSecret: input.outboundWebhookSecret,
            },
            now,
          )
        : OrganizationFraudConfig.create({
            id: generateOrganizationFraudConfigId(),
            organizationId,
            slaLowMinutes: input.slaLowMinutes,
            slaMediumMinutes: input.slaMediumMinutes,
            slaHighMinutes: input.slaHighMinutes,
            slaCriticalMinutes: input.slaCriticalMinutes,
            riskThresholdLow: input.riskThresholdLow,
            riskThresholdMedium: input.riskThresholdMedium,
            riskThresholdHigh: input.riskThresholdHigh,
            riskThresholdCritical: input.riskThresholdCritical,
            featureFlags: input.featureFlags,
            outboundWebhookUrl: input.outboundWebhookUrl,
            outboundWebhookSecret: input.outboundWebhookSecret,
            now,
          });

      await deps.repository.upsert(desired, tx);
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPSERT_ORGANIZATION_FRAUD_CONFIG',
          resource: 'organization_fraud_config',
          resourceId: String(desired.id),
          detail: organizationFraudConfigAuditDetail(desired),
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
      return desired;
    });
  };
}
