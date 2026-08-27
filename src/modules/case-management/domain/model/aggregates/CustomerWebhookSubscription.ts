import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CustomerWebhookSubscriptionId } from '../value-objects/CustomerWebhookSubscriptionId.js';
import type { WebhookTicketEventType } from '../value-objects/WebhookTicketEventType.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface CustomerWebhookSubscriptionProps {
  readonly id: CustomerWebhookSubscriptionId;
  readonly organizationId: string;
  readonly url: string;
  readonly eventTypes: readonly WebhookTicketEventType[];
  readonly active: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateCustomerWebhookSubscriptionInput {
  readonly id: CustomerWebhookSubscriptionId;
  readonly organizationId: string;
  readonly url: string;
  readonly eventTypes: readonly WebhookTicketEventType[];
  readonly active?: boolean;
  readonly now: Instant;
}

export interface UpdateCustomerWebhookSubscriptionInput {
  readonly url?: string;
  readonly eventTypes?: readonly WebhookTicketEventType[];
  readonly active?: boolean;
}

/**
 * Per-organization catalog row of a notification destination. Inactive rows
 * stay stored and never gate enforcement. Uniqueness of `(organizationId, url)`
 * is enforced at the repository/index layer, not here.
 */
export class CustomerWebhookSubscription {
  private constructor(private readonly props: CustomerWebhookSubscriptionProps) {}

  static create(input: CreateCustomerWebhookSubscriptionInput): CustomerWebhookSubscription {
    assertNonEmptyOrganizationId(input.organizationId);
    assertHttpUrl(input.url);
    assertEventTypes(input.eventTypes);
    return new CustomerWebhookSubscription({
      id: input.id,
      organizationId: input.organizationId,
      url: input.url,
      eventTypes: input.eventTypes,
      active: input.active ?? true,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: CustomerWebhookSubscriptionProps): CustomerWebhookSubscription {
    return new CustomerWebhookSubscription(props);
  }

  get id(): CustomerWebhookSubscriptionId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get url(): string {
    return this.props.url;
  }

  get eventTypes(): readonly WebhookTicketEventType[] {
    return this.props.eventTypes;
  }

  get active(): boolean {
    return this.props.active;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): CustomerWebhookSubscriptionProps {
    return this.props;
  }

  update(changes: UpdateCustomerWebhookSubscriptionInput, now: Instant): CustomerWebhookSubscription {
    const url = changes.url ?? this.props.url;
    const eventTypes = changes.eventTypes ?? this.props.eventTypes;
    assertHttpUrl(url);
    assertEventTypes(eventTypes);
    return new CustomerWebhookSubscription({
      ...this.props,
      url,
      eventTypes,
      active: changes.active ?? this.props.active,
      updatedAt: now,
    });
  }
}

function assertNonEmptyOrganizationId(value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation('CustomerWebhookSubscription organizationId must be a non-empty string', {
      field: 'organizationId',
      value,
    });
  }
}

function assertHttpUrl(value: string): void {
  if (!isHttpUrl(value)) {
    throw invariantViolation('CustomerWebhookSubscription url must be an http(s) URL', {
      field: 'url',
      value,
    });
  }
}

function assertEventTypes(eventTypes: readonly WebhookTicketEventType[]): void {
  if (eventTypes.length === 0) {
    throw invariantViolation('CustomerWebhookSubscription eventTypes must be a non-empty subset of allowed ticket names', {
      field: 'eventTypes',
      value: eventTypes,
    });
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
