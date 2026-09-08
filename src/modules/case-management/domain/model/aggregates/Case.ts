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
  readonly idempotencyKey: string | null;
  readonly riskScore: RiskScore;
  readonly status: CaseStatus;
  readonly priority: CasePriority;
  readonly assignedTo: AssignedTo | null;
  readonly dueDate: Instant | null;
  readonly tags: readonly string[];
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly deletedAt: Instant | null;
  readonly agentBrief?: string | null;
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
  readonly idempotencyKey?: string | null;
  readonly riskScore: RiskScore;
  readonly priority: CasePriority;
  readonly assignedTo?: AssignedTo | null;
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
      idempotencyKey: input.idempotencyKey ?? null,
      riskScore: input.riskScore,
      status: 'OPEN',
      priority: input.priority,
      assignedTo: input.assignedTo ?? null,
      dueDate: null,
      tags: input.tags ?? [],
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
      agentBrief: null,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CaseProps): Case {
    return new Case({ ...props, agentBrief: props.agentBrief ?? null });
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

  get idempotencyKey(): string | null {
    return this.props.idempotencyKey;
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

  get agentBrief(): string | null {
    return this.props.agentBrief ?? null;
  }

  /** Last-write-wins companion brief. Does not add a CaseNote. */
  withAgentBrief(brief: string, now: Instant): Case {
    return new Case({ ...this.props, agentBrief: brief, updatedAt: now });
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
   * Triage retag + reprioritize. Replaces the whole `tags` array (trimmed,
   * de-duplicated, order-preserving) and sets `priority`. SLA recalculation
   * is a caller concern (application layer) — the aggregate only carries the
   * new state. Returns a brand-new instance.
   */
  updatePriorityAndTags(priority: CasePriority, tags: readonly string[], now: Instant): Case {
    return new Case({
      ...this.props,
      priority,
      tags: normalizeTags(tags),
      updatedAt: now,
    });
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

  /**
   * CASE-007 — retag and severity change.
   *
   * Tags are normalized here and not at the HTTP edge: they are trimmed,
   * empties are dropped, and they are de-duplicated while preserving arrival
   * order. Without this the same criterion came in three times written
   * differently (`"AML"`, `" AML"`, `"AML "`) and CASE-004's tag filter,
   * which requires an exact match, stopped finding the case.
   *
   * Does not touch `dueDate`: recomputing the deadline is the concern of the
   * SLA paths, which are the only ones that may write that field.
   */
  reclassify(input: {
    readonly priority?: CasePriority;
    readonly tags?: readonly string[];
    readonly now: Instant;
  }): Case {
    const tags = input.tags === undefined ? this.props.tags : normalizeTags(input.tags);

    return new Case({
      ...this.props,
      priority: input.priority ?? this.props.priority,
      tags,
      updatedAt: input.now,
    });
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

/** Trims, drops empties, and de-duplicates while preserving first-seen order. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    collectTag(raw, seen, result);
  }
  return result;
}

/** Appends a trimmed, non-empty, not-yet-seen tag to `result`. */
function collectTag(raw: string, seen: Set<string>, result: string[]): void {
  const tag = raw.trim();
  if (tag.length === 0 || seen.has(tag)) {
    return;
  }
  seen.add(tag);
  result.push(tag);
}
