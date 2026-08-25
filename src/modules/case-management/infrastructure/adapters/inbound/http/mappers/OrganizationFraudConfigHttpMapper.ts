import type { OrganizationFraudConfig } from '../../../../../domain/model/aggregates/OrganizationFraudConfig.js';

export interface OrganizationFraudConfigResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly slaLowMinutes: number;
  readonly slaMediumMinutes: number;
  readonly slaHighMinutes: number;
  readonly slaCriticalMinutes: number;
  readonly riskThresholdLow: number;
  readonly riskThresholdMedium: number;
  readonly riskThresholdHigh: number;
  readonly riskThresholdCritical: number;
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly outboundWebhookUrl: string | null;
  /**
   * Si hay secreto de firma configurado. El valor NO sale: quien pueda leer la
   * configuracion podria si no firmar entregas indistinguibles de las nuestras.
   */
  readonly outboundWebhookSecretSet: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toOrganizationFraudConfigResponse(
  config: OrganizationFraudConfig,
): OrganizationFraudConfigResponseDto {
  return {
    id: config.id,
    organizationId: config.organizationId,
    slaLowMinutes: config.slaLowMinutes,
    slaMediumMinutes: config.slaMediumMinutes,
    slaHighMinutes: config.slaHighMinutes,
    slaCriticalMinutes: config.slaCriticalMinutes,
    riskThresholdLow: config.riskThresholdLow,
    riskThresholdMedium: config.riskThresholdMedium,
    riskThresholdHigh: config.riskThresholdHigh,
    riskThresholdCritical: config.riskThresholdCritical,
    featureFlags: config.featureFlags,
    outboundWebhookUrl: config.outboundWebhookUrl,
    outboundWebhookSecretSet: config.outboundWebhookSecret !== null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}
