import type { Instant } from '../../../../../shared/time/Instant.js';
import type { NotificationId } from '../value-objects/NotificationId.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { UserId } from '../value-objects/UserId.js';
import type { AlertType } from '../value-objects/AlertType.js';
import type { NotificationChannel } from '../value-objects/NotificationChannel.js';

export interface NotificationProps {
  readonly id: NotificationId;
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly context: Record<string, unknown>;
  readonly createdAt: Instant;
}

export interface CreateNotificationInput {
  readonly id: NotificationId;
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly context: Record<string, unknown>;
  readonly now: Instant;
}

/**
 * Append-only in-app notification row (design D2/D-notifications-delivery).
 * `alertType` reuses the closed `AlertType` catalog verbatim — no new type
 * VO. No mutators, no read/unread status (A2 — out of scope): a write-once
 * record, mirroring `NotificationPreference`'s private-ctor + static
 * create/rehydrate + immutable-props shape.
 */
export class Notification {
  private constructor(private readonly props: NotificationProps) {}

  static create(input: CreateNotificationInput): Notification {
    return new Notification({
      id: input.id,
      organizationId: input.organizationId,
      recipientUserId: input.recipientUserId,
      alertType: input.alertType,
      channel: input.channel,
      context: input.context,
      createdAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: NotificationProps): Notification {
    return new Notification(props);
  }

  get id(): NotificationId {
    return this.props.id;
  }

  get organizationId(): OrganizationId {
    return this.props.organizationId;
  }

  get recipientUserId(): UserId {
    return this.props.recipientUserId;
  }

  get alertType(): AlertType {
    return this.props.alertType;
  }

  get channel(): NotificationChannel {
    return this.props.channel;
  }

  get context(): Record<string, unknown> {
    return this.props.context;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): NotificationProps {
    return this.props;
  }
}
