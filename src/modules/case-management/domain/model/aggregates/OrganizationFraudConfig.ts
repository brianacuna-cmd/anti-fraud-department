import type { Instant } from '../../../../../shared/time/Instant.js';
import type { OrganizationFraudConfigId } from '../value-objects/OrganizationFraudConfigId.js';
import type { CasePriority } from '../value-objects/CasePriority.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface OrganizationFraudConfigProps {
  readonly id: OrganizationFraudConfigId;
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
  /** Tenant webhook URL for enforcement outbox delivery; null/empty = unset. */
  readonly outboundWebhookUrl: string | null;
  /**
   * Shared secret with the tenant for signing what we send them.
   *
   * It is PER TENANT and not of the deployment on purpose: with a single
   * secret, any tenant who knew theirs could forge signed deliveries to
   * another tenant's endpoint, and a forged sanction notification is exactly
   * what this channel cannot allow.
   *
   * `null` = unsigned. Allowed so as not to break integrations that are
   * already in place, but the receiver cannot distinguish our sends from
   * anyone else's who knows their URL.
   */
  readonly outboundWebhookSecret: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateOrganizationFraudConfigInput {
  readonly id: OrganizationFraudConfigId;
  readonly organizationId: string;
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
  readonly now: Instant;
}

export interface UpdateOrganizationFraudConfigInput {
  readonly slaLowMinutes?: number;
  readonly slaMediumMinutes?: number;
  readonly slaHighMinutes?: number;
  readonly slaCriticalMinutes?: number;
  readonly riskThresholdLow?: number;
  readonly riskThresholdMedium?: number;
  readonly riskThresholdHigh?: number;
  readonly riskThresholdCritical?: number;
  readonly featureFlags?: Readonly<Record<string, boolean>>;
  readonly outboundWebhookUrl?: string | null;
  readonly outboundWebhookSecret?: string | null;
}

const SLA_FIELDS = [
  'slaLowMinutes',
  'slaMediumMinutes',
  'slaHighMinutes',
  'slaCriticalMinutes',
] as const;

const RISK_THRESHOLD_FIELDS = [
  'riskThresholdLow',
  'riskThresholdMedium',
  'riskThresholdHigh',
  'riskThresholdCritical',
] as const;

/**
 * Per-tenant singleton (design: "OrganizationFraudConfig") — uniqueness
 * (one document per `OrganizationId`) is enforced at the repository/index
 * layer (`org_fraud_config_unique`), NOT here. Mirrors `Case`'s private-ctor
 * + create/rehydrate immutable-props shape.
 */
export class OrganizationFraudConfig {
  private constructor(private readonly props: OrganizationFraudConfigProps) {}

  static create(input: CreateOrganizationFraudConfigInput): OrganizationFraudConfig {
    assertNonEmptyOrganizationId(input.organizationId);
    for (const field of SLA_FIELDS) {
      assertNonNegative(field, input[field]);
    }
    for (const field of RISK_THRESHOLD_FIELDS) {
      assertNonNegative(field, input[field]);
    }
    return new OrganizationFraudConfig({
      id: input.id,
      organizationId: input.organizationId,
      slaLowMinutes: input.slaLowMinutes,
      slaMediumMinutes: input.slaMediumMinutes,
      slaHighMinutes: input.slaHighMinutes,
      slaCriticalMinutes: input.slaCriticalMinutes,
      riskThresholdLow: input.riskThresholdLow,
      riskThresholdMedium: input.riskThresholdMedium,
      riskThresholdHigh: input.riskThresholdHigh,
      riskThresholdCritical: input.riskThresholdCritical,
      featureFlags: input.featureFlags ?? {},
      outboundWebhookUrl: input.outboundWebhookUrl ?? null,
      outboundWebhookSecret: input.outboundWebhookSecret ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: OrganizationFraudConfigProps): OrganizationFraudConfig {
    return new OrganizationFraudConfig(props);
  }

  get id(): OrganizationFraudConfigId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get slaLowMinutes(): number {
    return this.props.slaLowMinutes;
  }

  get slaMediumMinutes(): number {
    return this.props.slaMediumMinutes;
  }

  get slaHighMinutes(): number {
    return this.props.slaHighMinutes;
  }

  get slaCriticalMinutes(): number {
    return this.props.slaCriticalMinutes;
  }

  get riskThresholdLow(): number {
    return this.props.riskThresholdLow;
  }

  get riskThresholdMedium(): number {
    return this.props.riskThresholdMedium;
  }

  get riskThresholdHigh(): number {
    return this.props.riskThresholdHigh;
  }

  get riskThresholdCritical(): number {
    return this.props.riskThresholdCritical;
  }

  get featureFlags(): Readonly<Record<string, boolean>> {
    return this.props.featureFlags;
  }

  get outboundWebhookUrl(): string | null {
    return this.props.outboundWebhookUrl;
  }

  get outboundWebhookSecret(): string | null {
    return this.props.outboundWebhookSecret;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): OrganizationFraudConfigProps {
    return this.props;
  }

  /** T2 SLA calculation reads this (design: "slaMinutesFor(priority):number"). */
  slaMinutesFor(priority: CasePriority): number {
    switch (priority) {
      case 'LOW':
        return this.props.slaLowMinutes;
      case 'MEDIUM':
        return this.props.slaMediumMinutes;
      case 'HIGH':
        return this.props.slaHighMinutes;
      case 'CRITICAL':
        return this.props.slaCriticalMinutes;
    }
  }

  /**
   * Highest risk band crossed for automated case open.
   * Returns `null` when score is below `riskThresholdLow` (orchestrator skips CreateCase).
   */
  priorityForRiskScore(score: number): CasePriority | null {
    if (score >= this.props.riskThresholdCritical) {
      return 'CRITICAL';
    }
    if (score >= this.props.riskThresholdHigh) {
      return 'HIGH';
    }
    if (score >= this.props.riskThresholdMedium) {
      return 'MEDIUM';
    }
    if (score >= this.props.riskThresholdLow) {
      return 'LOW';
    }
    return null;
  }

  /** Partial update — undefined fields keep their current value. Used by the Upsert use case. */
  update(patch: UpdateOrganizationFraudConfigInput, now: Instant): OrganizationFraudConfig {
    for (const field of [...SLA_FIELDS, ...RISK_THRESHOLD_FIELDS]) {
      assertPatchFieldNonNegative(patch, field);
    }
    return new OrganizationFraudConfig({
      ...this.props,
      ...patch,
      outboundWebhookUrl:
        patch.outboundWebhookUrl === undefined
          ? this.props.outboundWebhookUrl
          : patch.outboundWebhookUrl,
      outboundWebhookSecret:
        patch.outboundWebhookSecret === undefined
          ? this.props.outboundWebhookSecret
          : patch.outboundWebhookSecret,
      updatedAt: now,
    });
  }
}

function assertNonEmptyOrganizationId(value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation('OrganizationFraudConfig organizationId must be a non-empty string', {
      value,
    });
  }
}

function assertNonNegative(field: string, value: number): void {
  if (value < 0) {
    throw invariantViolation(`OrganizationFraudConfig ${field} must be a non-negative number`, {
      field,
      value,
    });
  }
}

type NumericPatchField = (typeof SLA_FIELDS)[number] | (typeof RISK_THRESHOLD_FIELDS)[number];

/** Validates one optional numeric patch field; a `undefined` field is a no-op (keeps current value). */
function assertPatchFieldNonNegative(patch: UpdateOrganizationFraudConfigInput, field: NumericPatchField): void {
  const value = patch[field];
  if (value === undefined) {
    return;
  }
  assertNonNegative(field, value);
}
