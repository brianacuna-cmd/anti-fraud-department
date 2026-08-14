import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import { OrganizationFraudConfig } from '../domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../domain/model/value-objects/OrganizationFraudConfigId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

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
}

export interface UpsertOrganizationFraudConfigDeps {
  readonly repository: OrganizationFraudConfigRepository;
  readonly clock: Clock;
}

/**
 * Idempotent per-tenant singleton write (design: "upsert(config, tx?)").
 * Reads the current row (if any) so a re-submission UPDATES it in place —
 * uniqueness is ultimately enforced by `org_fraud_config_unique`, this is
 * just the "no separate read vs create branch leaking into the aggregate"
 * pattern, mirrored from `SetNotificationPreference`.
 */
export function createUpsertOrganizationFraudConfigUseCase(deps: UpsertOrganizationFraudConfigDeps) {
  return async function upsertOrganizationFraudConfig(
    input: UpsertOrganizationFraudConfigInput,
  ): Promise<OrganizationFraudConfig> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    const existing = await deps.repository.findByOrganization(organizationId);
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
          now,
        });

    await deps.repository.upsert(desired);
    return desired;
  };
}
