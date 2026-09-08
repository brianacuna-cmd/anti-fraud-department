import type { Instant } from '../../../../../shared/time/Instant.js';
import type { RiskScoringRuleId } from '../value-objects/RiskScoringRuleId.js';
import type { ScoringRuleStatus } from '../value-objects/ScoringRuleStatus.js';
import { invariantViolation } from '../../errors/RiskAssessmentError.js';

export interface RiskScoringRuleProps {
  readonly id: RiskScoringRuleId;
  readonly organizationId: string;
  readonly name: string;
  /** Full JDM graph consumed by ZEN Engine (collect + Expression). */
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion: number;
  readonly status: ScoringRuleStatus;
  /**
   * Soft delete. The row survives because cases carry `ruleId` and
   * `conditionsVersion` in their frozen snapshot and audit rows: erasing the
   * rule would leave "which rule did this?" unanswerable months later, which
   * is exactly the question an auditor asks.
   */
  readonly deletedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateRiskScoringRuleInput {
  readonly id: RiskScoringRuleId;
  readonly organizationId: string;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion: number;
  readonly status?: ScoringRuleStatus;
  readonly now: Instant;
}

/**
 * Tenant-scoped scoring rule. Clone of CaseRoutingRule without target
 * user/role — each document holds one JDM graph evaluated by ZEN.
 * New rules default to INACTIVE (draft); activate via `activate()`.
 */
export class RiskScoringRule {
  private constructor(private readonly props: RiskScoringRuleProps) {}

  static create(input: CreateRiskScoringRuleInput): RiskScoringRule {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('name', input.name);
    assertNonNegative('conditionsVersion', input.conditionsVersion);
    return new RiskScoringRule({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      conditions: input.conditions,
      conditionsVersion: input.conditionsVersion,
      status: input.status ?? 'INACTIVE',
      deletedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: RiskScoringRuleProps): RiskScoringRule {
    return new RiskScoringRule(props);
  }

  /** Marks this draft as ACTIVE (immutable). Caller persists via repository. */
  activate(now: Instant): RiskScoringRule {
    return new RiskScoringRule({ ...this.props, status: 'ACTIVE', updatedAt: now });
  }

  /** Marks this rule as INACTIVE (immutable). Caller persists via repository. */
  deactivate(now: Instant): RiskScoringRule {
    return new RiskScoringRule({ ...this.props, status: 'INACTIVE', updatedAt: now });
  }

  /**
   * Hides the rule from the list without erasing it.
   *
   * Refuses on an ACTIVE rule: it is the ONLY thing scoring incoming events,
   * so removing it stops every case from opening — silently, because
   * `CalculateRiskScore` fails closed and nothing in the panel would say why.
   * Activate a replacement first; that retires this one on its own.
   */
  delete(now: Instant): RiskScoringRule {
    if (this.props.status === 'ACTIVE') {
      throw invariantViolation(
        'the ACTIVE scoring rule cannot be deleted: activate a replacement first',
        { ruleId: this.props.id },
      );
    }
    if (this.props.deletedAt !== null) {
      return this;
    }
    return new RiskScoringRule({ ...this.props, deletedAt: now, updatedAt: now });
  }

  get deletedAt(): Instant | null {
    return this.props.deletedAt;
  }

  get id(): RiskScoringRuleId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get conditions(): Readonly<Record<string, unknown>> {
    return this.props.conditions;
  }

  get conditionsVersion(): number {
    return this.props.conditionsVersion;
  }

  get status(): ScoringRuleStatus {
    return this.props.status;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): RiskScoringRuleProps {
    return this.props;
  }
}

function assertNonEmpty(field: 'organizationId' | 'name', value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`RiskScoringRule ${field} must be a non-empty string`, { field, value });
  }
}

function assertNonNegative(field: string, value: number): void {
  if (value < 0) {
    throw invariantViolation(`RiskScoringRule ${field} must be a non-negative number`, { field, value });
  }
}
