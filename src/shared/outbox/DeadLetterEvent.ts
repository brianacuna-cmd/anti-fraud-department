import type { Instant } from '../time/Instant.js';
import type { OutboxEventId } from './OutboxEventId.js';
import type { OutboxEvent } from './OutboxEvent.js';

export interface DeadLetterEventProps {
  readonly id: OutboxEventId;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly publishAttempts: number;
  readonly reason: string;
  readonly createdAt: Instant;
  readonly exhaustedAt: Instant;
}

/**
 * Immutable snapshot of an `OutboxEvent` that exhausted its retry budget.
 * Persisted to `dead_letter_queue` with the original event's ObjectId as
 * `_id` (D2: unique key by construction — see design). The owning use case
 * deletes the `outbox_events` row inside the same transaction.
 */
export class DeadLetterEvent {
  private constructor(private readonly props: DeadLetterEventProps) {}

  /**
   * Builds a `DeadLetterEvent` from an already-exhausted `OutboxEvent`
   * (i.e. one whose `markExhausted` was already called, so `lastError` is set
   * and `status` is `FAILED`).
   */
  static from(exhausted: OutboxEvent, exhaustedAt: Instant): DeadLetterEvent {
    return new DeadLetterEvent({
      id: exhausted.id,
      organizationId: exhausted.organizationId,
      eventType: exhausted.eventType,
      aggregateType: exhausted.aggregateType,
      aggregateId: exhausted.aggregateId,
      payload: exhausted.payload,
      publishAttempts: exhausted.publishAttempts,
      reason: exhausted.lastError ?? '',
      createdAt: exhausted.createdAt,
      exhaustedAt,
    });
  }

  get id(): OutboxEventId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get eventType(): string {
    return this.props.eventType;
  }

  get aggregateType(): string {
    return this.props.aggregateType;
  }

  get aggregateId(): string {
    return this.props.aggregateId;
  }

  get payload(): Record<string, unknown> {
    return this.props.payload;
  }

  get publishAttempts(): number {
    return this.props.publishAttempts;
  }

  get reason(): string {
    return this.props.reason;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get exhaustedAt(): Instant {
    return this.props.exhaustedAt;
  }

  toProps(): DeadLetterEventProps {
    return this.props;
  }
}
