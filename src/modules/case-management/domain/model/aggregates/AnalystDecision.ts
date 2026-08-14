import type { Instant } from '../../../../../shared/time/Instant.js';
import type { AnalystDecisionId } from '../value-objects/AnalystDecisionId.js';
import type { AnalystDecisionType } from '../value-objects/AnalystDecisionType.js';
import type { CaseId } from '../value-objects/CaseId.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface AnalystDecisionProps {
  readonly id: AnalystDecisionId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly decision: AnalystDecisionType;
  readonly confidence: number;
  readonly comment: string;
  readonly createdBy: string;
  readonly createdAt: Instant;
}

export interface CreateAnalystDecisionInput {
  readonly id: AnalystDecisionId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly decision: AnalystDecisionType;
  readonly confidence: number;
  readonly comment: string;
  readonly createdBy: string;
  readonly now: Instant;
}

/**
 * Immutable analyst decision row (design: analyst_decisions). Case status is
 * never mutated here — timeline / use-case layers own DECISION_MADE side effects.
 */
export class AnalystDecision {
  private constructor(private readonly props: AnalystDecisionProps) {}

  static create(input: CreateAnalystDecisionInput): AnalystDecision {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('createdBy', input.createdBy);
    assertConfidence(input.confidence);
    return new AnalystDecision({
      id: input.id,
      caseId: input.caseId,
      organizationId: input.organizationId,
      decision: input.decision,
      confidence: input.confidence,
      comment: input.comment,
      createdBy: input.createdBy,
      createdAt: input.now,
    });
  }

  static rehydrate(props: AnalystDecisionProps): AnalystDecision {
    return new AnalystDecision(props);
  }

  get id(): AnalystDecisionId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get decision(): AnalystDecisionType {
    return this.props.decision;
  }

  get confidence(): number {
    return this.props.confidence;
  }

  get comment(): string {
    return this.props.comment;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): AnalystDecisionProps {
    return this.props;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`AnalystDecision ${field} must be a non-empty string`, { field, value });
  }
}

function assertConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw invariantViolation('AnalystDecision confidence must be between 0 and 100', { value });
  }
}
