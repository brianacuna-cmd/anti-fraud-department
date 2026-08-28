import type { Instant } from '../../../../../shared/time/Instant.js';
import { toDate } from '../../../../../shared/time/Instant.js';
import type { SarReportId } from '../value-objects/SarReportId.js';
import type { SarReportStatus } from '../value-objects/SarReportStatus.js';
import { sarReportStatusTransitions } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import type { PostalAddress } from '../value-objects/PostalAddress.js';
import type { SuspiciousActivityCategory } from '../value-objects/SuspiciousActivityCategory.js';
import type { TinType } from '../value-objects/TinType.js';
import { invariantViolation, selfApprovalForbidden } from '../../errors/SarError.js';

export interface SarReportProps {
  readonly id: SarReportId;
  readonly organizationId: string;
  /**
   * Exactly one of these two is set — a SAR references ONE confirmed
   * source, never both and never neither (enforced in `create`).
   * Cross-module ids are stored as plain strings (ADR-0's "cross-module id
   * = plain string" rule) — `sar`'s domain never imports `case-management`
   * or `screening`'s domain types.
   */
  readonly caseId: string | null;
  readonly amlAlertId: string | null;
  readonly status: SarReportStatus;
  /** The suspicious-activity description. Required — a SAR with nothing written is not a draft. */
  readonly narrative: string;
  readonly subjectName: string | null;
  /**
   * Subject detail the filing schema asks for. All nullable because a SAR is
   * often drafted on what is known at the time — an unidentified counterparty
   * is a normal reason to file, not a reason to block the draft.
   * `SarFilingReadiness` is what refuses to BUILD the file without them.
   */
  readonly subjectAddress: PostalAddress | null;
  readonly subjectTin: string | null;
  readonly subjectTinType: TinType | null;
  readonly subjectBirthDate: Instant | null;
  readonly suspiciousAmount: number | null;
  readonly activityStartDate: Instant | null;
  readonly activityEndDate: Instant | null;
  /** How the activity is classified. Empty on a draft; required to file. */
  readonly activityCategories: readonly SuspiciousActivityCategory[];
  readonly createdBy: string;
  /** Set only once `approve()` has been called (SAR-002). */
  readonly approvedBy: string | null;
  readonly approvedAt: Instant | null;
  /**
   * Filing outcome (SAR-004). All null until the report is actually sent:
   * the tracking number comes back FROM the regulator, so it cannot exist
   * before submission.
   */
  readonly bsaIdentifier: string | null;
  readonly filedAt: Instant | null;
  readonly filedBy: string | null;
  readonly acknowledgementReference: string | null;
  readonly filingRejectionReason: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateSarReportInput {
  readonly id: SarReportId;
  readonly organizationId: string;
  readonly caseId?: string | null;
  readonly amlAlertId?: string | null;
  readonly narrative: string;
  readonly subjectName?: string | null;
  readonly subjectAddress?: PostalAddress | null;
  readonly subjectTin?: string | null;
  readonly subjectTinType?: TinType | null;
  readonly subjectBirthDate?: Instant | null;
  readonly suspiciousAmount?: number | null;
  readonly activityStartDate?: Instant | null;
  readonly activityEndDate?: Instant | null;
  readonly activityCategories?: readonly SuspiciousActivityCategory[];
  readonly createdBy: string;
  readonly now: Instant;
}

/**
 * A SAR draft (SAR-001). One aggregate per report; SAR-002 will add the
 * review/lock transitions on top of this same shape.
 */
export class SarReport {
  private constructor(private readonly props: SarReportProps) {}

  static create(input: CreateSarReportInput): SarReport {
    const caseId = input.caseId ?? null;
    const amlAlertId = input.amlAlertId ?? null;
    assertExactlyOneSource(caseId, amlAlertId);
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('createdBy', input.createdBy);
    assertNonEmpty('narrative', input.narrative);

    return new SarReport({
      id: input.id,
      organizationId: input.organizationId,
      caseId,
      amlAlertId,
      status: 'DRAFT',
      narrative: input.narrative,
      subjectName: input.subjectName ?? null,
      subjectAddress: input.subjectAddress ?? null,
      subjectTin: input.subjectTin?.trim() || null,
      subjectTinType: input.subjectTinType ?? null,
      subjectBirthDate: input.subjectBirthDate ?? null,
      suspiciousAmount: input.suspiciousAmount ?? null,
      activityStartDate: input.activityStartDate ?? null,
      activityEndDate: input.activityEndDate ?? null,
      activityCategories: dedupe(input.activityCategories ?? []),
      createdBy: input.createdBy,
      approvedBy: null,
      approvedAt: null,
      bsaIdentifier: null,
      filedAt: null,
      filedBy: null,
      acknowledgementReference: null,
      filingRejectionReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: SarReportProps): SarReport {
    return new SarReport(props);
  }

  /**
   * SAR-002: reviews, approves, and locks the report in one step. Four eyes
   * lives HERE, not in the use case — `ApprovalRequest.decide()`'s same
   * reasoning applies: there is exactly one path to `APPROVED`, so putting
   * the check anywhere else is a check that can someday be bypassed.
   */
  approve(approvedBy: string, now: Instant): SarReport {
    if (approvedBy.trim().length === 0) {
      throw invariantViolation('SarReport approvedBy must be a non-empty string', { approvedBy });
    }
    if (approvedBy === this.props.createdBy) {
      throw selfApprovalForbidden(this.props.createdBy, this.props.id);
    }
    assertTransitionAllowed(sarReportStatusTransitions, this.props.status, 'APPROVED');
    return new SarReport({
      ...this.props,
      status: 'APPROVED',
      approvedBy,
      approvedAt: now,
      updatedAt: now,
    });
  }

  /**
   * SAR-004: the regulator took it. Records the tracking number it gave back,
   * the acknowledgement and the date the submission was formally made.
   *
   * `filedAt` is supplied, not taken from the clock: the report is filed
   * through FinCEN's E-Filing system and recorded here afterwards, so the
   * date that matters is the one on the acknowledgement, not the one someone
   * got round to typing it in.
   *
   * Deliberately does NOT re-check filing readiness. The report is already
   * with the regulator — refusing to record that because a field looks thin
   * would leave the system claiming a filing never happened.
   */
  recordFiling(input: {
    bsaIdentifier: string;
    filedAt: Instant;
    filedBy: string;
    acknowledgementReference?: string | null;
    now: Instant;
  }): SarReport {
    assertBsaIdentifier(input.bsaIdentifier);
    assertNonEmpty('filedBy', input.filedBy);
    assertNotInFuture(input.filedAt, input.now);
    assertTransitionAllowed(sarReportStatusTransitions, this.props.status, 'FILED');

    return new SarReport({
      ...this.props,
      status: 'FILED',
      bsaIdentifier: input.bsaIdentifier.trim(),
      filedAt: input.filedAt,
      filedBy: input.filedBy,
      acknowledgementReference: input.acknowledgementReference?.trim() || null,
      /* A successful re-submission clears the earlier rejection. */
      filingRejectionReason: null,
      updatedAt: input.now,
    });
  }

  /**
   * SAR-004: the regulator bounced it.
   *
   * The reason is required. A rejection with no reason is the same dead end
   * as no record at all — whoever picks the report up next has to know what
   * to fix before re-submitting.
   */
  recordFilingRejection(input: { reason: string; recordedBy: string; now: Instant }): SarReport {
    assertNonEmpty('filingRejectionReason', input.reason);
    assertNonEmpty('recordedBy', input.recordedBy);
    assertTransitionAllowed(sarReportStatusTransitions, this.props.status, 'FILING_REJECTED');

    return new SarReport({
      ...this.props,
      status: 'FILING_REJECTED',
      filingRejectionReason: input.reason.trim(),
      updatedAt: input.now,
    });
  }

  get id(): SarReportId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get caseId(): string | null {
    return this.props.caseId;
  }

  get amlAlertId(): string | null {
    return this.props.amlAlertId;
  }

  get status(): SarReportStatus {
    return this.props.status;
  }

  get narrative(): string {
    return this.props.narrative;
  }

  get subjectName(): string | null {
    return this.props.subjectName;
  }

  get subjectAddress(): PostalAddress | null {
    return this.props.subjectAddress;
  }

  get subjectTin(): string | null {
    return this.props.subjectTin;
  }

  get subjectTinType(): TinType | null {
    return this.props.subjectTinType;
  }

  get subjectBirthDate(): Instant | null {
    return this.props.subjectBirthDate;
  }

  get activityCategories(): readonly SuspiciousActivityCategory[] {
    return this.props.activityCategories;
  }

  get suspiciousAmount(): number | null {
    return this.props.suspiciousAmount;
  }

  get activityStartDate(): Instant | null {
    return this.props.activityStartDate;
  }

  get activityEndDate(): Instant | null {
    return this.props.activityEndDate;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get approvedBy(): string | null {
    return this.props.approvedBy;
  }

  get approvedAt(): Instant | null {
    return this.props.approvedAt;
  }

  get bsaIdentifier(): string | null {
    return this.props.bsaIdentifier;
  }

  get filedAt(): Instant | null {
    return this.props.filedAt;
  }

  get filedBy(): string | null {
    return this.props.filedBy;
  }

  get acknowledgementReference(): string | null {
    return this.props.acknowledgementReference;
  }

  get filingRejectionReason(): string | null {
    return this.props.filingRejectionReason;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): SarReportProps {
    return this.props;
  }
}

function assertExactlyOneSource(caseId: string | null, amlAlertId: string | null): void {
  const provided = [caseId, amlAlertId].filter((value) => value !== null);
  if (provided.length !== 1) {
    throw invariantViolation(
      'SarReport requires exactly one of caseId or amlAlertId, never both or neither',
      { caseId, amlAlertId },
    );
  }
}

/**
 * A FinCEN BSA Identifier is 14 digits.
 *
 * Kept as a named constant, like `FILING_LIMITS`, so that checking it against
 * the current specification is reading one line. Rejecting a malformed one
 * here beats storing a tracking number that leads nowhere when a regulator
 * asks for the filing months later.
 */
const BSA_IDENTIFIER_DIGITS = 14;

function assertBsaIdentifier(value: string): void {
  const trimmed = value.trim();
  if (!new RegExp(`^\\d{${BSA_IDENTIFIER_DIGITS}}$`).test(trimmed)) {
    throw invariantViolation(
      `the BSA identifier must be ${BSA_IDENTIFIER_DIGITS} digits`,
      { bsaIdentifier: value },
    );
  }
}

/** A filing cannot have happened tomorrow. */
function assertNotInFuture(filedAt: Instant, now: Instant): void {
  if (toDate(filedAt).getTime() > toDate(now).getTime()) {
    throw invariantViolation('filedAt is in the future', {});
  }
}

function assertNonEmpty(
  field: 'organizationId' | 'createdBy' | 'narrative' | 'filedBy' | 'recordedBy' | 'filingRejectionReason',
  value: string,
): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`SarReport ${field} must be a non-empty string`, { field, value });
  }
}

/**
 * The same category twice says nothing twice. Deduping on the way in keeps
 * the generated file from carrying a repeated element that some validators
 * accept and others reject.
 */
function dedupe(
  categories: readonly SuspiciousActivityCategory[],
): readonly SuspiciousActivityCategory[] {
  return [...new Set(categories)];
}
