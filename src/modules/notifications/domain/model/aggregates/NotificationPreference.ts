import type { Instant } from '../../../../../shared/time/Instant.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { UserId } from '../value-objects/UserId.js';
import type { AlertType } from '../value-objects/AlertType.js';
import type { NotificationChannel } from '../value-objects/NotificationChannel.js';

export interface NotificationPreferenceProps {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateNotificationPreferenceInput {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly now: Instant;
}

/**
 * Identity IS the natural composite key `(organizationId, userId, alertType,
 * channel)` (design D1) — no client-minted surrogate id. Mirrors `Session`'s
 * shape (private ctor + static `create`/`rehydrate`, immutable props,
 * getters). No mutator methods: a toggle is an absolute SET of `enabled`
 * from the request, not a relative flip, so there is no read-modify state
 * transition on the aggregate — `SetNotificationPreference` always builds a
 * fresh desired post-state via `create` and hands it to `repository.upsert`.
 */
export class NotificationPreference {
  private constructor(private readonly props: NotificationPreferenceProps) {}

  static create(input: CreateNotificationPreferenceInput): NotificationPreference {
    return new NotificationPreference({
      organizationId: input.organizationId,
      userId: input.userId,
      alertType: input.alertType,
      channel: input.channel,
      enabled: input.enabled,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: NotificationPreferenceProps): NotificationPreference {
    return new NotificationPreference(props);
  }

  get organizationId(): OrganizationId {
    return this.props.organizationId;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get alertType(): AlertType {
    return this.props.alertType;
  }

  get channel(): NotificationChannel {
    return this.props.channel;
  }

  get enabled(): boolean {
    return this.props.enabled;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): NotificationPreferenceProps {
    return this.props;
  }
}
