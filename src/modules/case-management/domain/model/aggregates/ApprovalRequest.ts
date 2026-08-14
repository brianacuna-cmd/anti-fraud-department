import type { Instant } from '../../../../../shared/time/Instant.js';
import type { ApprovalRequestId } from '../value-objects/ApprovalRequestId.js';
import type { ApprovalRequestStatus } from '../value-objects/ApprovalRequestStatus.js';
import type { EnforcementActionId } from '../value-objects/EnforcementActionId.js';
import { approvalRequestStatusTransitions } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface ApprovalRequestProps {
  readonly id: ApprovalRequestId;
  readonly enforcementActionId: EnforcementActionId;
  readonly requesterId: string;
  readonly reviewerId: string | null;
  readonly status: ApprovalRequestStatus;
  readonly reviewerComment: string | null;
  readonly createdAt: Instant;
  readonly reviewedAt: Instant | null;
}

export interface CreateApprovalRequestInput {
  readonly id: ApprovalRequestId;
  readonly enforcementActionId: EnforcementActionId;
  readonly requesterId: string;
  readonly now: Instant;
}

export interface ReviewApprovalRequestInput {
  readonly reviewerId: string;
  readonly reviewerComment: string | null;
  readonly now: Instant;
}

/** Approval gate for non-REVIEW enforcement actions (design: approval_requests). */
export class ApprovalRequest {
  private constructor(private readonly props: ApprovalRequestProps) {}

  static create(input: CreateApprovalRequestInput): ApprovalRequest {
    assertNonEmpty('requesterId', input.requesterId);
    return new ApprovalRequest({
      id: input.id,
      enforcementActionId: input.enforcementActionId,
      requesterId: input.requesterId,
      reviewerId: null,
      status: 'PENDING',
      reviewerComment: null,
      createdAt: input.now,
      reviewedAt: null,
    });
  }

  static rehydrate(props: ApprovalRequestProps): ApprovalRequest {
    return new ApprovalRequest(props);
  }

  get id(): ApprovalRequestId {
    return this.props.id;
  }

  get enforcementActionId(): EnforcementActionId {
    return this.props.enforcementActionId;
  }

  get requesterId(): string {
    return this.props.requesterId;
  }

  get reviewerId(): string | null {
    return this.props.reviewerId;
  }

  get status(): ApprovalRequestStatus {
    return this.props.status;
  }

  get reviewerComment(): string | null {
    return this.props.reviewerComment;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get reviewedAt(): Instant | null {
    return this.props.reviewedAt;
  }

  toProps(): ApprovalRequestProps {
    return this.props;
  }

  approve(input: ReviewApprovalRequestInput): ApprovalRequest {
    return this.decide('APPROVED', input);
  }

  reject(input: ReviewApprovalRequestInput): ApprovalRequest {
    return this.decide('REJECTED', input);
  }

  private decide(next: 'APPROVED' | 'REJECTED', input: ReviewApprovalRequestInput): ApprovalRequest {
    assertNonEmpty('reviewerId', input.reviewerId);
    assertTransitionAllowed(approvalRequestStatusTransitions, this.props.status, next);
    return new ApprovalRequest({
      ...this.props,
      status: next,
      reviewerId: input.reviewerId,
      reviewerComment: input.reviewerComment,
      reviewedAt: input.now,
    });
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`ApprovalRequest ${field} must be a non-empty string`, {
      field,
      value,
    });
  }
}
