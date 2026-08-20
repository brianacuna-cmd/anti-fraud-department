import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { ResolutionId } from '../value-objects/ResolutionId.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

/** The terminal status a resolution moved the case into. */
export type ResolutionClosureType = 'RESOLVED' | 'ARCHIVED';

export interface ResolutionProps {
  readonly id: ResolutionId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly closureType: ResolutionClosureType;
  readonly reason: string;
  readonly resolvedBy: string;
  readonly createdAt: Instant;
}

export interface CreateResolutionInput {
  readonly id: ResolutionId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly closureType: ResolutionClosureType;
  readonly reason: string;
  readonly resolvedBy: string;
  readonly now: Instant;
}

/**
 * A formal case closure record (append-only, 1:N per case — reopening does
 * NOT void prior resolutions, it adds history). `closureType` is the status
 * the case moved into (RESOLVED via resolve, ARCHIVED via archive).
 */
export class Resolution {
  private constructor(private readonly props: ResolutionProps) {}

  static create(input: CreateResolutionInput): Resolution {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw invariantViolation('Resolution reason must be a non-empty string', { field: 'reason' });
    }
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('resolvedBy', input.resolvedBy);
    return new Resolution({
      id: input.id,
      caseId: input.caseId,
      organizationId: input.organizationId,
      closureType: input.closureType,
      reason,
      resolvedBy: input.resolvedBy,
      createdAt: input.now,
    });
  }

  static rehydrate(props: ResolutionProps): Resolution {
    return new Resolution(props);
  }

  get id(): ResolutionId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get closureType(): ResolutionClosureType {
    return this.props.closureType;
  }

  get reason(): string {
    return this.props.reason;
  }

  get resolvedBy(): string {
    return this.props.resolvedBy;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`Resolution ${field} must be a non-empty string`, { field, value });
  }
}
