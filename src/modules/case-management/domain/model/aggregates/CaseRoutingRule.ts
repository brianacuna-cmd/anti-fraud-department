import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseRoutingRuleId } from '../value-objects/CaseRoutingRuleId.js';
import type { RoutingRuleStatus } from '../value-objects/RoutingRuleStatus.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface CaseRoutingRuleProps {
  readonly id: CaseRoutingRuleId;
  readonly organizationId: string;
  readonly name: string;
  /** Full JDM graph consumed by ZEN Engine (design: CaseRoutingRules.Conditions). */
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion: number;
  readonly targetRoleId: string | null;
  readonly targetUserId: string | null;
  readonly status: RoutingRuleStatus;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateCaseRoutingRuleInput {
  readonly id: CaseRoutingRuleId;
  readonly organizationId: string;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion: number;
  readonly targetRoleId?: string | null;
  readonly targetUserId?: string | null;
  readonly status?: RoutingRuleStatus;
  readonly now: Instant;
}

/**
 * Tenant-scoped routing rule (design: "CaseRoutingRules"). Each document holds
 * one JDM graph evaluated by ZEN Engine during T1 auto-routing.
 * New rules default to INACTIVE (draft); activate via a later use case.
 */
export class CaseRoutingRule {
  private constructor(private readonly props: CaseRoutingRuleProps) {}

  static create(input: CreateCaseRoutingRuleInput): CaseRoutingRule {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('name', input.name);
    assertNonNegative('conditionsVersion', input.conditionsVersion);
    return new CaseRoutingRule({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      conditions: input.conditions,
      conditionsVersion: input.conditionsVersion,
      targetRoleId: input.targetRoleId ?? null,
      targetUserId: input.targetUserId ?? null,
      status: input.status ?? 'INACTIVE',
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CaseRoutingRuleProps): CaseRoutingRule {
    return new CaseRoutingRule(props);
  }

  get id(): CaseRoutingRuleId {
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

  get targetRoleId(): string | null {
    return this.props.targetRoleId;
  }

  get targetUserId(): string | null {
    return this.props.targetUserId;
  }

  get status(): RoutingRuleStatus {
    return this.props.status;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): CaseRoutingRuleProps {
    return this.props;
  }
}

function assertNonEmpty(field: 'organizationId' | 'name', value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`CaseRoutingRule ${field} must be a non-empty string`, { field, value });
  }
}

function assertNonNegative(field: string, value: number): void {
  if (value < 0) {
    throw invariantViolation(`CaseRoutingRule ${field} must be a non-negative number`, { field, value });
  }
}
