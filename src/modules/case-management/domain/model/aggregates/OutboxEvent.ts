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

  /**
   * El evento salio. `publishedAt` guarda cuando, y `error` se limpia: un
   * reintento con exito no debe dejar el motivo del fallo anterior colgando,
   * porque quien lo lea despues no sabria si el estado actual es bueno o malo.
   */
  markPublished(now: Instant): OutboxEvent {
    return new OutboxEvent({ ...this.props, status: 'PUBLISHED', publishedAt: now, error: null });
  }

  /**
   * El intento fallo. Se conserva el motivo y NO se toca `publishedAt`, que
   * sigue siendo null: un evento fallido nunca llego a publicarse.
   */
  markFailed(reason: string): OutboxEvent {
    return new OutboxEvent({ ...this.props, status: 'FAILED', error: reason });
  }
}
