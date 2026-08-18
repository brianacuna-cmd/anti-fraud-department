import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { InvestigationId } from '../value-objects/InvestigationId.js';
import type { InvestigationSubjectType } from '../value-objects/InvestigationSubjectType.js';
import type { InvestigationStatus } from '../value-objects/InvestigationStatus.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface InvestigationProps {
  readonly id: InvestigationId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly subjectType: InvestigationSubjectType;
  readonly subjectId: string;
  readonly status: InvestigationStatus;
  readonly findings: string | null;
  readonly openedBy: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly closedAt: Instant | null;
}

export interface OpenInvestigationInput {
  readonly id: InvestigationId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly subjectType: InvestigationSubjectType;
  readonly subjectId: string;
  readonly openedBy: string;
  readonly now: Instant;
}

/**
 * An investigation into one entity (wallet/email/customer) tied to a case
 * (1:N). Opens OPEN with no findings; `close` (PR3) records findings and sets
 * CLOSED. Carries a stable id so later cuts (evidence, SAR) can reference it.
 */
export class Investigation {
  private constructor(private readonly props: InvestigationProps) {}

  static open(input: OpenInvestigationInput): Investigation {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('subjectId', input.subjectId);
    assertNonEmpty('openedBy', input.openedBy);
    return new Investigation({
      id: input.id,
      caseId: input.caseId,
      organizationId: input.organizationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: 'OPEN',
      findings: null,
      openedBy: input.openedBy,
      createdAt: input.now,
      updatedAt: input.now,
      closedAt: null,
    });
  }

  static rehydrate(props: InvestigationProps): Investigation {
    return new Investigation(props);
  }

  get id(): InvestigationId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get subjectType(): InvestigationSubjectType {
    return this.props.subjectType;
  }

  get subjectId(): string {
    return this.props.subjectId;
  }

  get status(): InvestigationStatus {
    return this.props.status;
  }

  get findings(): string | null {
    return this.props.findings;
  }

  get openedBy(): string {
    return this.props.openedBy;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  get closedAt(): Instant | null {
    return this.props.closedAt;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`Investigation ${field} must be a non-empty string`, { field, value });
  }
}
