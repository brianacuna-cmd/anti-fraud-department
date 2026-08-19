import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type {
  NotificationListPage,
  NotificationRepository,
} from '../domain/ports/NotificationRepository.js';
import type { Notification } from '../domain/model/aggregates/Notification.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createNotificationId } from '../domain/model/value-objects/NotificationId.js';
import { forbiddenCrossTenant, notificationNotFound } from '../domain/errors/NotificationsError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

const MAX_LIMIT = 100;

export interface ListNotificationsInput {
  readonly auth: AuthContext;
  readonly limit?: number;
  readonly unreadOnly?: boolean;
}

export interface ListNotificationsDeps {
  readonly notifications: NotificationRepository;
}

/**
 * La bandeja del usuario que llama, y solo la suya.
 *
 * El destinatario sale del contexto de autenticacion y nunca de un parametro:
 * aceptar un `userId` por la ruta convertiria la bandeja en un lector de los
 * avisos ajenos, que en un departamento antifraude incluyen que casos se le
 * asignaron a quien.
 */
export function createListNotificationsUseCase(deps: ListNotificationsDeps) {
  return async function listNotifications(input: ListNotificationsInput): Promise<NotificationListPage> {
    const organizationId = requireTenantContext(input.auth);

    const requested = Math.trunc(input.limit ?? 50);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : 50;

    return deps.notifications.listForUser(
      createOrganizationId(organizationId),
      createUserId(input.auth.userId),
      { limit, unreadOnly: input.unreadOnly },
    );
  };
}

export interface MarkNotificationReadInput {
  readonly auth: AuthContext;
  readonly notificationId: string;
}

export interface MarkNotificationReadDeps {
  readonly notifications: NotificationRepository;
  readonly clock: Clock;
}

export function createMarkNotificationReadUseCase(deps: MarkNotificationReadDeps) {
  return async function markNotificationRead(input: MarkNotificationReadInput): Promise<Notification> {
    const organizationId = requireTenantContext(input.auth);

    const notification = await deps.notifications.findById(createNotificationId(input.notificationId));
    if (!notification) {
      throw notificationNotFound(input.notificationId);
    }

    // Se comprueba el inquilino Y el destinatario: nadie marca por leido el
    // aviso de otra persona, ni siquiera dentro de la misma organizacion.
    if (
      notification.organizationId !== organizationId ||
      notification.recipientUserId !== input.auth.userId
    ) {
      throw forbiddenCrossTenant('esta notificacion pertenece a otra persona');
    }

    const updated = notification.markRead(deps.clock.now());
    if (updated !== notification) {
      await deps.notifications.save(updated);
    }
    return updated;
  };
}
