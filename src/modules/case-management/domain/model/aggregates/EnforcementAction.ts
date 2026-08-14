import type { Instant } from '../../../../../shared/time/Instant.js';
import type { AnalystDecisionId } from '../value-objects/AnalystDecisionId.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { EnforcementActionId } from '../value-objects/EnforcementActionId.js';
import type { EnforcementActionStatus } from '../value-objects/EnforcementActionStatus.js';
import type { EnforcementActionType } from '../value-objects/EnforcementActionType.js';
import { enforcementActionStatusTransitions } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invalidTransition, invariantViolation } from '../../errors/CaseManagementError.js';

export interface EnforcementActionProps {
  readonly id: EnforcementActionId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly analystDecisionId: AnalystDecisionId;
  readonly actionType: EnforcementActionType;
  readonly targetType: string;
  readonly targetId: string;
  readonly status: EnforcementActionStatus;
  readonly createdBy: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateEnforcementActionInput {
  readonly id: EnforcementActionId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly analystDecisionId: AnalystDecisionId;
  readonly actionType: EnforcementActionType;
  readonly targetType: string;
  readonly targetId: string;
  readonly createdBy: string;
  readonly now: Instant;
}

/**
 * Enforcement lifecycle aggregate (design: enforcement_actions). Multiple
 * concurrent PENDING/APPROVED actions per case are allowed at the repo layer.
 */
export class EnforcementAction {
  private constructor(private readonly props: EnforcementActionProps) {}

  static create(input: CreateEnforcementActionInput): EnforcementAction {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('targetType', input.targetType);
    assertNonEmpty('targetId', input.targetId);
    assertNonEmpty('createdBy', input.createdBy);
    return new EnforcementAction({
      id: input.id,
      caseId: input.caseId,
      organizationId: input.organizationId,
      analystDecisionId: input.analystDecisionId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      status: 'PENDING',
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: EnforcementActionProps): EnforcementAction {
    return new EnforcementAction(props);
  }

  get id(): EnforcementActionId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get analystDecisionId(): AnalystDecisionId {
    return this.props.analystDecisionId;
  }

  get actionType(): EnforcementActionType {
    return this.props.actionType;
  }

  get targetType(): string {
    return this.props.targetType;
  }

  get targetId(): string {
    return this.props.targetId;
  }

  get status(): EnforcementActionStatus {
    return this.props.status;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): EnforcementActionProps {
    return this.props;
  }

  approve(now: Instant): EnforcementAction {
    return this.transitionTo('APPROVED', now);
  }

  reject(now: Instant): EnforcementAction {
    return this.transitionTo('REJECTED', now);
  }

  /**
   * REVIEW may execute from PENDING; all other types require APPROVED first.
   * The transition table still lists PENDING→EXECUTED so REVIEW can use it;
   * non-REVIEW is rejected here before the table check would allow it.
   */
  execute(now: Instant): EnforcementAction {
    if (this.props.status === 'PENDING' && this.props.actionType !== 'REVIEW') {
      throw invalidTransition(this.props.status, 'EXECUTED');
    }
    return this.transitionTo('EXECUTED', now);
  }

  revert(now: Instant): EnforcementAction {
    return this.transitionTo('REVERTED', now);
  }

  private transitionTo(next: EnforcementActionStatus, now: Instant): EnforcementAction {
    assertTransitionAllowed(enforcementActionStatusTransitions, this.props.status, next);
    return new EnforcementAction({ ...this.props, status: next, updatedAt: now });
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`EnforcementAction ${field} must be a non-empty string`, {
      field,
      value,
    });
  }
}
