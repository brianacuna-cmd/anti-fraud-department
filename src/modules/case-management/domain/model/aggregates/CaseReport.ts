import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { CaseReportId } from '../value-objects/CaseReportId.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

/** Frozen snapshot of the full case graph at generation time. */
export type CaseReportSnapshot = Readonly<Record<string, unknown>>;

export interface CaseReportProps {
  readonly id: CaseReportId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly generatedBy: string;
  readonly snapshot: CaseReportSnapshot;
  readonly createdAt: Instant;
}

export interface CreateCaseReportInput {
  readonly id: CaseReportId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly generatedBy: string;
  readonly snapshot: CaseReportSnapshot;
  readonly now: Instant;
}

/**
 * An immutable, persisted snapshot of a case (detail + timeline + notes +
 * investigations + resolutions + enforcement + decisions) captured at a point
 * in time. The case keeps mutating; the report is frozen for audit/export — no
 * update method exists.
 */
export class CaseReport {
  private constructor(private readonly props: CaseReportProps) {}

  static create(input: CreateCaseReportInput): CaseReport {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('generatedBy', input.generatedBy);
    return new CaseReport({
      id: input.id,
      caseId: input.caseId,
      organizationId: input.organizationId,
      generatedBy: input.generatedBy,
      snapshot: input.snapshot,
      createdAt: input.now,
    });
  }

  static rehydrate(props: CaseReportProps): CaseReport {
    return new CaseReport(props);
  }

  get id(): CaseReportId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get generatedBy(): string {
    return this.props.generatedBy;
  }

  get snapshot(): CaseReportSnapshot {
    return this.props.snapshot;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`CaseReport ${field} must be a non-empty string`, { field, value });
  }
}
