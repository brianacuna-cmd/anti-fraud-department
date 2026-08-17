import type { Instant } from '../../../../../shared/time/Instant.js';

export type OutboxEventStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface OutboxEventProps {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly status: OutboxEventStatus;
  readonly createdAt: Instant;
  readonly publishedAt: Instant | null;
  readonly error: string | null;
}

export interface CreateOutboxEventInput {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly now: Instant;
}

export class OutboxEvent {
  private constructor(private readonly props: OutboxEventProps) {}

  static create(input: CreateOutboxEventInput): OutboxEvent {
    return new OutboxEvent({
      id: input.id,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      status: 'PENDING',
      createdAt: input.now,
      publishedAt: null,
      error: null,
    });
  }

  static rehydrate(props: OutboxEventProps): OutboxEvent {
    return new OutboxEvent(props);
  }

  get id(): string {
    return this.props.id;
  }

  get aggregateType(): string {
    return this.props.aggregateType;
  }

  get aggregateId(): string {
    return this.props.aggregateId;
  }

  get eventType(): string {
    return this.props.eventType;
  }

  get payload(): Record<string, unknown> {
    return this.props.payload;
  }

  get status(): OutboxEventStatus {
    return this.props.status;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get publishedAt(): Instant | null {
    return this.props.publishedAt;
  }

  get error(): string | null {
    return this.props.error;
  }

  toProps(): OutboxEventProps {
    return this.props;
  }
}
