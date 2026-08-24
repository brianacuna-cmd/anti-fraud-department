import type { Instant } from '../../../../../shared/time/Instant.js';
import type { OrganizationScreeningConfigId } from '../value-objects/OrganizationScreeningConfigId.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export interface OrganizationScreeningConfigProps {
  readonly id: OrganizationScreeningConfigId;
  readonly organizationId: string;
  readonly alertThreshold: number;
  readonly signalThreshold: number;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateOrganizationScreeningConfigInput {
  readonly id: OrganizationScreeningConfigId;
  readonly organizationId: string;
  readonly alertThreshold: number;
  readonly signalThreshold: number;
  readonly now: Instant;
}

/**
 * Per-tenant singleton (design D-6): per-org confianza thresholds used by
 * screening's watchlist tiering. Uniqueness (one document per organization)
 * is enforced at the repository/index layer (`org_screening_config_unique`),
 * NOT here — mirrors `OrganizationFraudConfig`'s private-ctor +
 * create/rehydrate immutable-props shape. Unlike `OrganizationFraudConfig`,
 * a MISSING row is not an error (RF-6): `GetOrganizationScreeningConfig`
 * falls back to `DEFAULT_CONFIDENCE_THRESHOLDS` instead of throwing.
 */
export class OrganizationScreeningConfig {
  private constructor(private readonly props: OrganizationScreeningConfigProps) {}

  static create(input: CreateOrganizationScreeningConfigInput): OrganizationScreeningConfig {
    assertNonEmptyOrganizationId(input.organizationId);
    assertInRange('alertThreshold', input.alertThreshold);
    assertInRange('signalThreshold', input.signalThreshold);
    assertAlertNotAboveSignal(input.alertThreshold, input.signalThreshold);
    return new OrganizationScreeningConfig({
      id: input.id,
      organizationId: input.organizationId,
      alertThreshold: input.alertThreshold,
      signalThreshold: input.signalThreshold,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: OrganizationScreeningConfigProps): OrganizationScreeningConfig {
    return new OrganizationScreeningConfig(props);
  }

  get id(): OrganizationScreeningConfigId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get alertThreshold(): number {
    return this.props.alertThreshold;
  }

  get signalThreshold(): number {
    return this.props.signalThreshold;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): OrganizationScreeningConfigProps {
    return this.props;
  }
}

function assertNonEmptyOrganizationId(value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation('OrganizationScreeningConfig organizationId must be a non-empty string', {
      value,
    });
  }
}

function assertInRange(field: 'alertThreshold' | 'signalThreshold', value: number): void {
  if (value < 0 || value > 100) {
    throw invariantViolation(`OrganizationScreeningConfig ${field} must be between 0 and 100`, {
      field,
      value,
    });
  }
}

function assertAlertNotAboveSignal(alertThreshold: number, signalThreshold: number): void {
  if (alertThreshold > signalThreshold) {
    throw invariantViolation(
      'OrganizationScreeningConfig alertThreshold must be <= signalThreshold',
      { alertThreshold, signalThreshold },
    );
  }
}
