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
  /** Catalog position; duplicates allowed; list/findActive tie-break on createdAt ASC. */
  readonly executionOrder: number;
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

export interface CreateCaseRoutingRuleInput {
  readonly id: CaseRoutingRuleId;
  readonly organizationId: string;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion: number;
  readonly targetRoleId?: string | null;
  readonly targetUserId?: string | null;
  readonly status?: RoutingRuleStatus;
  readonly executionOrder?: number;
  readonly now: Instant;
}

export interface UpdateCaseRoutingRuleInput {
  readonly name?: string;
  readonly conditions?: Readonly<Record<string, unknown>>;
  readonly targetRoleId?: string | null;
  readonly targetUserId?: string | null;
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
    const executionOrder = input.executionOrder ?? 0;
    assertNonNegative('executionOrder', executionOrder);
    return new CaseRoutingRule({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      conditions: input.conditions,
      conditionsVersion: input.conditionsVersion,
      targetRoleId: input.targetRoleId ?? null,
      targetUserId: input.targetUserId ?? null,
      status: input.status ?? 'INACTIVE',
      deletedAt: null,
      executionOrder,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CaseRoutingRuleProps): CaseRoutingRule {
    return new CaseRoutingRule(props);
  }

  /** Marks this draft as ACTIVE (immutable). Caller persists via repository. */
  activate(now: Instant): CaseRoutingRule {
    return new CaseRoutingRule({ ...this.props, status: 'ACTIVE', updatedAt: now });
  }

  /** Marks this rule as INACTIVE (immutable). Caller persists via repository. */
  deactivate(now: Instant): CaseRoutingRule {
    return new CaseRoutingRule({ ...this.props, status: 'INACTIVE', updatedAt: now });
  }

  /**
   * Patches name, conditions, and/or targets. Status is not patchable —
   * activate/deactivate own that transition. conditionsVersion increments
   * only when conditions JSON differs (JSON.stringify).
   */
  update(changes: UpdateCaseRoutingRuleInput, now: Instant): CaseRoutingRule {
    if ('status' in changes) {
      throw invariantViolation('CaseRoutingRule status cannot be changed via update; use activate or deactivate', {
        field: 'status',
      });
    }
    const name = changes.name ?? this.props.name;
    assertNonEmpty('name', name);
    const conditions = changes.conditions ?? this.props.conditions;
    const conditionsChanged =
      changes.conditions !== undefined &&
      JSON.stringify(changes.conditions) !== JSON.stringify(this.props.conditions);
    return new CaseRoutingRule({
      ...this.props,
      name,
      conditions,
      conditionsVersion: conditionsChanged ? this.props.conditionsVersion + 1 : this.props.conditionsVersion,
      targetRoleId: changes.targetRoleId !== undefined ? changes.targetRoleId : this.props.targetRoleId,
      targetUserId: changes.targetUserId !== undefined ? changes.targetUserId : this.props.targetUserId,
      updatedAt: now,
    });
  }

  /**
   * Catalog reorder only. Does not bump conditionsVersion. Status stays
   * as-is. Caller persists via repository.
   */
  withExecutionOrder(executionOrder: number, now: Instant): CaseRoutingRule {
    assertNonNegative('executionOrder', executionOrder);
    return new CaseRoutingRule({ ...this.props, executionOrder, updatedAt: now });
  }

  /**
   * Hides the rule from the list without erasing it.
   *
   * Refuses on an ACTIVE rule: deactivate it first. Deleting one that is live
   * would change who gets the next case without that showing anywhere as a
   * routing change — deactivating says so out loud.
   */
  delete(now: Instant): CaseRoutingRule {
    if (this.props.status === 'ACTIVE') {
      throw invariantViolation('an ACTIVE routing rule cannot be deleted: deactivate it first', {
        ruleId: this.props.id,
      });
    }
    if (this.props.deletedAt !== null) {
      return this;
    }
    return new CaseRoutingRule({ ...this.props, deletedAt: now, updatedAt: now });
  }

  get deletedAt(): Instant | null {
    return this.props.deletedAt;
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

  get executionOrder(): number {
    return this.props.executionOrder;
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
