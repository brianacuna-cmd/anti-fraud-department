import type { Instant } from '../../../../../shared/time/Instant.js';
import type { NotificationOrgConfigId } from '../value-objects/NotificationOrgConfigId.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export interface NotificationOrgConfigProps {
  readonly id: NotificationOrgConfigId;
  readonly organizationId: OrganizationId;
  /** Outbound Slack/Webhook destination; `null` = unset (Req 1). */
  readonly webhookUrl: string | null;
  /** Stored for forward-compatibility only — not read/used this change (Req 4). */
  readonly secret: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateNotificationOrgConfigInput {
  readonly id: NotificationOrgConfigId;
  readonly organizationId: OrganizationId;
  readonly webhookUrl?: string | null;
  readonly secret?: string | null;
  readonly now: Instant;
}

export interface UpdateNotificationOrgConfigInput {
  /** `undefined` = keep current value, `null` = clear. */
  readonly webhookUrl?: string | null;
  readonly secret?: string | null;
}

/**
 * Per-tenant singleton (spec Req 1) — uniqueness (one document per
 * `OrganizationId`) is enforced at the repository/index layer, NOT here.
 * Mirrors `OrganizationFraudConfig`'s private-ctor + create/rehydrate
 * immutable-props shape.
 */
export class NotificationOrgConfig {
  private constructor(private readonly props: NotificationOrgConfigProps) {}

  static create(input: CreateNotificationOrgConfigInput): NotificationOrgConfig {
    const webhookUrl = input.webhookUrl ?? null;
    assertWebhookUrl(webhookUrl);
    return new NotificationOrgConfig({
      id: input.id,
      organizationId: input.organizationId,
      webhookUrl,
      secret: input.secret ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: NotificationOrgConfigProps): NotificationOrgConfig {
    return new NotificationOrgConfig(props);
  }

  get id(): NotificationOrgConfigId {
    return this.props.id;
  }

  get organizationId(): OrganizationId {
    return this.props.organizationId;
  }

  get webhookUrl(): string | null {
    return this.props.webhookUrl;
  }

  get secret(): string | null {
    return this.props.secret;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): NotificationOrgConfigProps {
    return this.props;
  }

  /** Partial update — `undefined` fields keep their current value, `null` clears. */
  update(patch: UpdateNotificationOrgConfigInput, now: Instant): NotificationOrgConfig {
    const webhookUrl = patch.webhookUrl === undefined ? this.props.webhookUrl : patch.webhookUrl;
    assertWebhookUrl(webhookUrl);
    return new NotificationOrgConfig({
      ...this.props,
      webhookUrl,
      secret: patch.secret === undefined ? this.props.secret : patch.secret,
      updatedAt: now,
    });
  }
}

function assertWebhookUrl(value: string | null): void {
  if (value === null) {
    return;
  }
  if (!isHttpUrl(value)) {
    throw invariantViolation('NotificationOrgConfig webhookUrl must be an http(s) URL', {
      field: 'webhookUrl',
      value,
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
