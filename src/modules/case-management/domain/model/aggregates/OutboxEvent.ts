import type { Instant } from '../../../../../shared/time/Instant.js';
import type { OutboxEventId } from '../value-objects/OutboxEventId.js';
import type { OutboxEventStatus } from '../value-objects/OutboxEventStatus.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface OutboxEventProps {
  readonly id: OutboxEventId;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly status: OutboxEventStatus;
  readonly publishAttempts: number;
  readonly lastError: string | null;
  readonly publishedAt: Instant | null;
  readonly nextRetryAt: Instant | null;
  readonly lockedUntil: Instant | null;
  readonly createdAt: Instant;
}

export interface CreateOutboxEventInput {
  readonly id: OutboxEventId;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly now: Instant;
}

/**
 * Transactional-outbox row (company schema: `outbox_events`). Inserted in the
 * SAME transaction as the business mutation that produced it, so the event and
 * the state change commit atomically. Opens PENDING with attempts 0; a relay
 * worker (out of scope here) claims and publishes it.
 */
export class OutboxEvent {
  private constructor(private readonly props: OutboxEventProps) {}

  static create(input: CreateOutboxEventInput): OutboxEvent {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('eventType', input.eventType);
    assertNonEmpty('aggregateType', input.aggregateType);
    assertNonEmpty('aggregateId', input.aggregateId);
    return new OutboxEvent({
      id: input.id,
      organizationId: input.organizationId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      status: 'PENDING',
      publishAttempts: 0,
      lastError: null,
      publishedAt: null,
      nextRetryAt: null,
      lockedUntil: null,
      createdAt: input.now,
    });
  }

  static rehydrate(props: OutboxEventProps): OutboxEvent {
    return new OutboxEvent(props);
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

  get status(): OutboxEventStatus {
    return this.props.status;
  }

  get publishAttempts(): number {
    return this.props.publishAttempts;
  }

  get lastError(): string | null {
    return this.props.lastError;
  }

  get publishedAt(): Instant | null {
    return this.props.publishedAt;
  }

  get nextRetryAt(): Instant | null {
    return this.props.nextRetryAt;
  }

  get lockedUntil(): Instant | null {
    return this.props.lockedUntil;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): OutboxEventProps {
    return this.props;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`OutboxEvent ${field} must be a non-empty string`, { field, value });
  }
}
