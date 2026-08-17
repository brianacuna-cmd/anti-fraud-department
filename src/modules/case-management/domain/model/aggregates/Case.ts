import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { CaseStatus } from '../value-objects/CaseStatus.js';
import type { CasePriority } from '../value-objects/CasePriority.js';
import type { RiskScore } from '../value-objects/RiskScore.js';
import type { AssignedTo } from '../value-objects/AssignedTo.js';
import { caseStatusTransitions } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation, invalidTransition } from '../../errors/CaseManagementError.js';

export interface CaseProps {
  readonly id: CaseId;
  readonly organizationId: string;
  readonly customerId: string;
  readonly customerEmail: string | null;
  readonly bridgeUserId: string | null;
  readonly bridgeWallet: string | null;
  readonly stripeCustomerId: string | null;
  readonly finturuReference: Record<string, unknown> | null;
  readonly finturuCacheSnapshot: Record<string, unknown> | null;
  readonly riskScore: RiskScore;
  readonly status: CaseStatus;
  readonly priority: CasePriority;
  readonly assignedTo: AssignedTo | null;
  readonly dueDate: Instant | null;
  readonly tags: readonly string[];
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly deletedAt: Instant | null;
}

export interface CreateCaseInput {
  readonly id: CaseId;
  readonly organizationId: string;
  readonly customerId: string;
  readonly customerEmail?: string | null;
  readonly bridgeUserId?: string | null;
  readonly bridgeWallet?: string | null;
  readonly stripeCustomerId?: string | null;
  readonly finturuReference?: Record<string, unknown> | null;
  readonly finturuCacheSnapshot?: Record<string, unknown> | null;
  readonly riskScore: RiskScore;
  readonly priority: CasePriority;
  readonly tags?: readonly string[];
  readonly now: Instant;
}

/**
 * Tenant-scoped fraud investigation record (design: "Case aggregate").
 * Immutable — every mutating method returns a brand-new instance, mirroring
 * `Organization`'s private-ctor + create/rehydrate shape.
 */
export class Case {
  private constructor(private readonly props: CaseProps) {}

  static create(input: CreateCaseInput): Case {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('customerId', input.customerId);
    return new Case({
      id: input.id,
      organizationId: input.organizationId,
      customerId: input.customerId,
      customerEmail: input.customerEmail ?? null,
      bridgeUserId: input.bridgeUserId ?? null,
      bridgeWallet: input.bridgeWallet ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      finturuReference: input.finturuReference ?? null,
      finturuCacheSnapshot: input.finturuCacheSnapshot ?? null,
      riskScore: input.riskScore,
      status: 'OPEN',
      priority: input.priority,
      assignedTo: null,
      dueDate: null,
      tags: input.tags ?? [],
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CaseProps): Case {
    return new Case(props);
  }

  get id(): CaseId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get customerEmail(): string | null {
    return this.props.customerEmail;
  }

  get bridgeUserId(): string | null {
    return this.props.bridgeUserId;
  }

  get bridgeWallet(): string | null {
    return this.props.bridgeWallet;
  }

  get stripeCustomerId(): string | null {
    return this.props.stripeCustomerId;
  }

  get finturuReference(): Record<string, unknown> | null {
    return this.props.finturuReference;
  }

  get finturuCacheSnapshot(): Record<string, unknown> | null {
    return this.props.finturuCacheSnapshot;
  }

  get riskScore(): RiskScore {
    return this.props.riskScore;
  }

  get status(): CaseStatus {
    return this.props.status;
  }

  get priority(): CasePriority {
    return this.props.priority;
  }

  get assignedTo(): AssignedTo | null {
    return this.props.assignedTo;
  }

  get dueDate(): Instant | null {
    return this.props.dueDate;
  }

  get tags(): readonly string[] {
    return this.props.tags;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  get deletedAt(): Instant | null {
    return this.props.deletedAt;
  }

  toProps(): CaseProps {
    return this.props;
  }

  /** Forward-path transition (OPEN -> IN_REVIEW -> RESOLVED -> ARCHIVED). Table-driven, never an if/switch cascade. */
  transitionTo(next: CaseStatus, now: Instant): Case {
    assertTransitionAllowed(caseStatusTransitions, this.props.status, next);
    return new Case({ ...this.props, status: next, updatedAt: now });
  }

  /**
   * T6 reopen (spec: "Reopen from RESOLVED" / "Reopen from OPEN rejected").
   * Reopen is ONLY valid from RESOLVED or ARCHIVED — `transitionTo`'s table
   * alone is not enough to reject an OPEN->IN_REVIEW *reopen* call, since
   * that same edge is a perfectly valid forward transition. Current status
   * is gated explicitly here before delegating to the shared table for the
   * target-edge check.
   */
  reopen(next: CaseStatus, now: Instant): Case {
    if (this.props.status !== 'RESOLVED' && this.props.status !== 'ARCHIVED') {
      throw invalidTransition(this.props.status, next);
    }
    assertTransitionAllowed(caseStatusTransitions, this.props.status, next);
    return new Case({ ...this.props, status: next, updatedAt: now });
  }

  /** Reassigns the case (or clears assignment when `assignedTo` is `null`). */
  reassign(assignedTo: AssignedTo | null, now: Instant): Case {
    return new Case({ ...this.props, assignedTo, updatedAt: now });
  }

  /**
   * Read-model denormalization write ONLY from SLA paths (design:
   * "Denormalization (LOCKED default)") — `CaseSlaTracking.DueDate` is the
   * source of truth; this mirrors it onto `Cases.DueDate` for inbox
   * filtering without a `$lookup`.
   */
  withDueDate(dueDate: Instant | null, now: Instant): Case {
    return new Case({ ...this.props, dueDate, updatedAt: now });
  }

  updateFinturuSnapshot(input: {
    readonly finturuCacheSnapshot: Record<string, unknown>;
    readonly riskScore?: RiskScore;
    readonly priority?: CasePriority;
    readonly customerEmail?: string | null;
    readonly bridgeUserId?: string | null;
    readonly bridgeWallet?: string | null;
    readonly stripeCustomerId?: string | null;
    readonly now: Instant;
  }): Case {
    return new Case({
      ...this.props,
      finturuCacheSnapshot: input.finturuCacheSnapshot,
      riskScore: input.riskScore ?? this.props.riskScore,
      priority: input.priority ?? this.props.priority,
      customerEmail: input.customerEmail ?? this.props.customerEmail,
      bridgeUserId: input.bridgeUserId ?? this.props.bridgeUserId,
      bridgeWallet: input.bridgeWallet ?? this.props.bridgeWallet,
      stripeCustomerId: input.stripeCustomerId ?? this.props.stripeCustomerId,
      updatedAt: input.now,
    });
  }
}

function assertNonEmpty(field: 'organizationId' | 'customerId', value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`Case ${field} must be a non-empty string`, { field, value });
  }
}
