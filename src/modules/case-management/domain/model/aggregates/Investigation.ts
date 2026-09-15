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
  /** Structured JSON findings of the investigated network (PATCH findings). */
  readonly findingsData: Record<string, unknown> | null;
  /** How deep the network exploration went (`profundidad_explorada`), >= 0. */
  readonly explorationDepth: number | null;
  readonly openedBy: string;
  /** Other existing cases associated to this deep-investigation record. */
  readonly linkedCaseIds: readonly CaseId[];
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
 * (1:N): the anchor of a network view. It has no lifecycle of its own — the
 * case already has one, and a second set of statuses nobody drove only
 * duplicated it. What the analyst concludes goes into a case note.
 *
 * `status`, `findings` and `closedAt` stay readable because investigations
 * closed before this change carry them; new ones are born OPEN and stay so.
 * Carries a stable id so evidence and SAR can reference it.
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
      findingsData: null,
      explorationDepth: null,
      openedBy: input.openedBy,
      linkedCaseIds: [],
      createdAt: input.now,
      updatedAt: input.now,
      closedAt: null,
    });
  }

  static rehydrate(props: InvestigationProps): Investigation {
    return new Investigation(props);
  }

  /**
   * Records the structured JSON findings and the exploration depth
   * (`profundidad_explorada`) of the investigated network. `explorationDepth` must be a non-negative integer.
   */
  recordFindings(
    findingsData: Record<string, unknown>,
    explorationDepth: number,
    now: Instant,
  ): Investigation {
    if (!Number.isInteger(explorationDepth) || explorationDepth < 0) {
      throw invariantViolation('Investigation explorationDepth must be a non-negative integer', {
        field: 'explorationDepth',
        value: explorationDepth,
      });
    }
    return new Investigation({
      ...this.props,
      findingsData,
      explorationDepth,
      updatedAt: now,
    });
  }

  /**
   * Associates existing cases to this deep-investigation record. Merges into
   * the current set (de-duplicated, the primary `caseId` excluded — it is
   * already this investigation's own case). Caller (application) validates the
   * cases exist and belong to the tenant first. Returns a brand-new instance.
   */
  linkCases(caseIds: readonly CaseId[], now: Instant): Investigation {
    const seen = new Set<string>(this.props.linkedCaseIds.map((id) => id as string));
    const primary = this.props.caseId as string;
    const merged = [...this.props.linkedCaseIds];
    for (const caseId of caseIds) {
      collectLinkedCase(caseId, primary, seen, merged);
    }
    return new Investigation({ ...this.props, linkedCaseIds: merged, updatedAt: now });
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

  get findingsData(): Record<string, unknown> | null {
    return this.props.findingsData;
  }

  get explorationDepth(): number | null {
    return this.props.explorationDepth;
  }

  get openedBy(): string {
    return this.props.openedBy;
  }

  get linkedCaseIds(): readonly CaseId[] {
    return this.props.linkedCaseIds;
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

/** Appends a case to `merged` unless it is the primary case or already linked. */
function collectLinkedCase(
  caseId: CaseId,
  primary: string,
  seen: Set<string>,
  merged: CaseId[],
): void {
  const key = caseId as string;
  if (key === primary || seen.has(key)) {
    return;
  }
  seen.add(key);
  merged.push(caseId);
}
