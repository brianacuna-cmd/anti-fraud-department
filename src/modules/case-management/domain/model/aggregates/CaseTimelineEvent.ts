import type { Instant } from '../../../../../shared/time/Instant.js';
import type { TimelineEventId } from '../value-objects/TimelineEventId.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { TimelineEventType } from '../value-objects/TimelineEventType.js';

export interface CaseTimelineEventProps {
  readonly id: TimelineEventId;
  readonly caseId: CaseId;
  readonly eventType: TimelineEventType;
  readonly previousValue: string | null;
  readonly newValue: string | null;
  /** Plain string — cross-module actor id, not branded (mirrors AuditLog.actorId). `null` for system-triggered events. */
  readonly createdBy: string | null;
  readonly createdAt: Instant;
}

/**
 * Append-only timeline record for a `Case` (spec: "CaseTimeline is
 * append-only", design: "CaseTimelineEvent ... Only static create()/
 * rehydrate(); written via TimelineRecorder.record (insertOne, never
 * replace)"). No `update`/`delete`/transition methods exist by design —
 * mirrors `AuditLog`'s immutable shape exactly.
 */
export class CaseTimelineEvent {
  private constructor(private readonly props: CaseTimelineEventProps) {}

  static create(props: CaseTimelineEventProps): CaseTimelineEvent {
    return new CaseTimelineEvent(props);
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CaseTimelineEventProps): CaseTimelineEvent {
    return new CaseTimelineEvent(props);
  }

  get id(): TimelineEventId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get eventType(): TimelineEventType {
    return this.props.eventType;
  }

  get previousValue(): string | null {
    return this.props.previousValue;
  }

  get newValue(): string | null {
    return this.props.newValue;
  }

  get createdBy(): string | null {
    return this.props.createdBy;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): CaseTimelineEventProps {
    return this.props;
  }
}
