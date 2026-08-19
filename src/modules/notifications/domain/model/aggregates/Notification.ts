import type { Instant } from '../../../../../shared/time/Instant.js';
import type { NotificationId } from '../value-objects/NotificationId.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { UserId } from '../value-objects/UserId.js';
import type { AlertType } from '../value-objects/AlertType.js';
import type { NotificationChannel } from '../value-objects/NotificationChannel.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export interface NotificationProps {
  readonly id: NotificationId;
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly title: string;
  readonly body: string;
  /** Que entidad motivo el aviso, para que la interfaz pueda enlazar a ella. */
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly readAt: Instant | null;
  readonly createdAt: Instant;
}

export interface CreateNotificationInput {
  readonly id: NotificationId;
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly title: string;
  readonly body: string;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly now: Instant;
}

/**
 * Un aviso entregado a una persona concreta.
 *
 * Distinto de `NotificationPreference`: la preferencia dice que quiere
 * recibir; esto es lo que efectivamente se le entrego. Se guardan por
 * separado porque cambiar una preferencia no debe reescribir el historial de
 * lo ya avisado — un aviso que se envio, se envio.
 *
 * `readAt` es un instante y no un booleano: saber CUANDO se leyo un aviso de
 * SLA a punto de vencer es justo el dato que hace falta al reconstruir por que
 * un caso se paso de plazo.
 */
export class Notification {
  private constructor(private readonly props: NotificationProps) {}

  static create(input: CreateNotificationInput): Notification {
    if (input.title.trim().length === 0) {
      throw invariantViolation('Notification title must be a non-empty string', { title: input.title });
    }

    return new Notification({
      id: input.id,
      organizationId: input.organizationId,
      recipientUserId: input.recipientUserId,
      alertType: input.alertType,
      channel: input.channel,
      title: input.title.trim(),
      body: input.body.trim(),
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      readAt: null,
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
  get title(): string {
    return this.props.title;
  }
  get body(): string {
    return this.props.body;
  }
  get resourceType(): string | null {
    return this.props.resourceType;
  }
  get resourceId(): string | null {
    return this.props.resourceId;
  }
  get readAt(): Instant | null {
    return this.props.readAt;
  }
  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get isRead(): boolean {
    return this.props.readAt !== null;
  }

  toProps(): NotificationProps {
    return this.props;
  }

  /**
   * Idempotente a proposito: marcar dos veces conserva la marca original. La
   * interfaz marca al abrir la bandeja, y sobrescribir la fecha en cada
   * apertura destruiria el unico dato que responde "cuando se entero".
   */
  markRead(now: Instant): Notification {
    if (this.props.readAt !== null) return this;
    return new Notification({ ...this.props, readAt: now });
  }
}
