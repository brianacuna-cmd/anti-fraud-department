import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseSlaTrackingId } from '../value-objects/CaseSlaTrackingId.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { SlaStatus } from '../value-objects/SlaStatus.js';
import { slaStatusTransitions } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';

export interface CaseSlaTrackingProps {
  readonly id: CaseSlaTrackingId;
  readonly caseId: CaseId;
  readonly dueDate: Instant;
  readonly status: SlaStatus;
  readonly notifiedStatuses: ReadonlySet<SlaStatus>;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateCaseSlaTrackingInput {
  readonly id: CaseSlaTrackingId;
  readonly caseId: CaseId;
  readonly dueDate: Instant;
  readonly now: Instant;
}

/**
 * One SLA-tracking row per `Case` (spec: "CaseSlaTracking status lifecycle",
 * unique per CaseId — enforced at the repository/index layer, never here).
 * Owns `DueDate` as the source of truth (design: "Denormalization (LOCKED
 * default)") — `Cases.DueDate` is only ever a read-model copy of this value.
 * Mirrors `Case`'s private-ctor + create/rehydrate immutable-props shape.
 */
export class CaseSlaTracking {
  private constructor(private readonly props: CaseSlaTrackingProps) {}

  static create(input: CreateCaseSlaTrackingInput): CaseSlaTracking {
    return new CaseSlaTracking({
      id: input.id,
      caseId: input.caseId,
      dueDate: input.dueDate,
      status: 'ON_TRACK',
      notifiedStatuses: new Set(),
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CaseSlaTrackingProps): CaseSlaTracking {
    return new CaseSlaTracking(props);
  }

  get id(): CaseSlaTrackingId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get dueDate(): Instant {
    return this.props.dueDate;
  }

  get status(): SlaStatus {
    return this.props.status;
  }

  get notifiedStatuses(): ReadonlySet<SlaStatus> {
    return this.props.notifiedStatuses;
  }

  hasNotified(status: SlaStatus): boolean {
    return this.props.notifiedStatuses.has(status);
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): CaseSlaTrackingProps {
    return this.props;
  }

  /** Forward-only sweep transition (ON_TRACK -> WARNING -> BREACHED). Table-driven, never an if/switch cascade. */
  advanceTo(next: SlaStatus, now: Instant): CaseSlaTracking {
    assertTransitionAllowed(slaStatusTransitions, this.props.status, next);
    return new CaseSlaTracking({ ...this.props, status: next, updatedAt: now });
  }

  /** Marks the sweep's notification as sent FOR THIS STATUS — idempotency guard for `SweepSlaTracking` (Slice 13, PR1: per-status re-notify). */
  markNotified(status: SlaStatus, now: Instant): CaseSlaTracking {
    return new CaseSlaTracking({
      ...this.props,
      notifiedStatuses: new Set([...this.props.notifiedStatuses, status]),
      updatedAt: now,
    });
  }

  /**
   * T6 reopen-to-OPEN reset (spec: "Reopen from RESOLVED to OPEN resets
   * SLA") — bypasses `slaStatusTransitions` entirely (BREACHED has no
   * outgoing edge) and rehydrates a fresh ON_TRACK row with a recomputed
   * `dueDate`, mirroring `Case.withDueDate`'s read-model-write shape.
   */
  reset(dueDate: Instant, now: Instant): CaseSlaTracking {
    return new CaseSlaTracking({
      ...this.props,
      dueDate,
      status: 'ON_TRACK',
      notifiedStatuses: new Set(),
      updatedAt: now,
    });
  }
}
