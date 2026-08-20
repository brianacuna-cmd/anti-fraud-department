import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CustomerOutgoingEventId } from '../value-objects/CustomerOutgoingEventId.js';
import type { CustomerOutgoingEventStatus } from '../value-objects/CustomerOutgoingEventStatus.js';
import type { EnforcementActionId } from '../value-objects/EnforcementActionId.js';
import { customerOutgoingEventStatusTransitions } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

/** Minimal webhook payload contract (spec: exactly these six fields). */
export interface CustomerOutgoingEventPayload {
  readonly enforcement_action_id: string;
  readonly case_id: string;
  readonly action_type: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly organization_id: string;
}

export interface CustomerOutgoingEventProps {
  readonly id: CustomerOutgoingEventId;
  readonly organizationId: string;
  readonly customerId: string;
  readonly enforcementActionId: EnforcementActionId;
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly payload: CustomerOutgoingEventPayload;
  readonly status: CustomerOutgoingEventStatus;
  readonly responseStatus: number | null;
  readonly attempts: number;
  readonly lastAttemptAt: Instant | null;
  readonly createdAt: Instant;
}

export interface CreateCustomerOutgoingEventInput {
  readonly id: CustomerOutgoingEventId;
  readonly organizationId: string;
  readonly customerId: string;
  readonly enforcementActionId: EnforcementActionId;
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly payload: CustomerOutgoingEventPayload;
  readonly now: Instant;
}

export interface DeliveryAttemptInput {
  readonly responseStatus: number;
  readonly now: Instant;
}

const MAX_ATTEMPTS = 5;

/**
 * Transactional outbox row for customer webhooks (design: customer_outgoing_events).
 * Dispatcher claims PENDING with attempts < 5; FAILED is terminal after the 5th failure.
 */
export class CustomerOutgoingEvent {
  private constructor(private readonly props: CustomerOutgoingEventProps) {}

  static create(input: CreateCustomerOutgoingEventInput): CustomerOutgoingEvent {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('customerId', input.customerId);
    assertNonEmpty('webhookUrl', input.webhookUrl);
    assertNonEmpty('eventType', input.eventType);
    return new CustomerOutgoingEvent({
      id: input.id,
      organizationId: input.organizationId,
      customerId: input.customerId,
      enforcementActionId: input.enforcementActionId,
      webhookUrl: input.webhookUrl,
      eventType: input.eventType,
      payload: input.payload,
      status: 'PENDING',
      responseStatus: null,
      attempts: 0,
      lastAttemptAt: null,
      createdAt: input.now,
    });
  }

  static rehydrate(props: CustomerOutgoingEventProps): CustomerOutgoingEvent {
    return new CustomerOutgoingEvent(props);
  }

  get id(): CustomerOutgoingEventId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get enforcementActionId(): EnforcementActionId {
    return this.props.enforcementActionId;
  }

  get webhookUrl(): string {
    return this.props.webhookUrl;
  }

  get eventType(): string {
    return this.props.eventType;
  }

  get payload(): CustomerOutgoingEventPayload {
    return this.props.payload;
  }

  get status(): CustomerOutgoingEventStatus {
    return this.props.status;
  }

  get responseStatus(): number | null {
    return this.props.responseStatus;
  }

  get attempts(): number {
    return this.props.attempts;
  }

  get lastAttemptAt(): Instant | null {
    return this.props.lastAttemptAt;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): CustomerOutgoingEventProps {
    return this.props;
  }

  markSent(input: DeliveryAttemptInput): CustomerOutgoingEvent {
    assertTransitionAllowed(customerOutgoingEventStatusTransitions, this.props.status, 'SENT');
    return new CustomerOutgoingEvent({
      ...this.props,
      status: 'SENT',
      responseStatus: input.responseStatus,
      attempts: this.props.attempts + 1,
      lastAttemptAt: input.now,
    });
  }

  /**
   * Records a failed POST. Stays PENDING until attempts reach MAX_ATTEMPTS,
   * then transitions to FAILED (terminal).
   */
  recordFailure(input: DeliveryAttemptInput): CustomerOutgoingEvent {
    if (this.props.status !== 'PENDING') {
      assertTransitionAllowed(customerOutgoingEventStatusTransitions, this.props.status, 'FAILED');
    }
    const attempts = this.props.attempts + 1;
    const status: CustomerOutgoingEventStatus = attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
    if (status === 'FAILED') {
      assertTransitionAllowed(customerOutgoingEventStatusTransitions, this.props.status, 'FAILED');
    }
    return new CustomerOutgoingEvent({
      ...this.props,
      status,
      responseStatus: input.responseStatus,
      attempts,
      lastAttemptAt: input.now,
    });
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`CustomerOutgoingEvent ${field} must be a non-empty string`, {
      field,
      value,
    });
  }
}
