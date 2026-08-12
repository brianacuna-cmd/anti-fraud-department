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

  /** Partial update — undefined fields keep their current value. Used by the Upsert use case. */
  update(patch: UpdateOrganizationFraudConfigInput, now: Instant): OrganizationFraudConfig {
    for (const field of SLA_FIELDS) {
      const value = patch[field];
      if (value !== undefined) {
        assertNonNegative(field, value);
      }
    }
    for (const field of RISK_THRESHOLD_FIELDS) {
      const value = patch[field];
      if (value !== undefined) {
        assertNonNegative(field, value);
      }
    }
    return new OrganizationFraudConfig({
      ...this.props,
      ...patch,
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
