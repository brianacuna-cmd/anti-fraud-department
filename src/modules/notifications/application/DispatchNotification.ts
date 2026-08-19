import type { Clock } from '../../../shared/time/Clock.js';
import type { NotificationRepository } from '../domain/ports/NotificationRepository.js';
import type { NotificationPreferenceRepository } from '../domain/ports/NotificationPreferenceRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { NotificationId } from '../domain/model/value-objects/NotificationId.js';
import type { NotificationChannel } from '../domain/model/value-objects/NotificationChannel.js';
import { Notification } from '../domain/model/aggregates/Notification.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createAlertType } from '../domain/model/value-objects/AlertType.js';

export interface DispatchNotificationInput {
  readonly organizationId: string;
  readonly recipientUserId: string;
  readonly alertType: string;
  readonly title: string;
  readonly body: string;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  /** Canales a intentar. Por defecto solo la bandeja del panel. */
  readonly channels?: readonly NotificationChannel[];
  readonly tx?: Transaction;
}

export interface DispatchNotificationDeps {
  readonly notifications: NotificationRepository;
  readonly preferences: NotificationPreferenceRepository;
  readonly clock: Clock;
  readonly generateNotificationId: () => NotificationId;
}

/**
 * Entrega un aviso a una persona, respetando sus preferencias.
 *
 * Dos decisiones que gobiernan el resto:
 *
 * 1. **Ausencia de preferencia significa SI.** Un usuario que nunca abrio la
 *    pantalla de notificaciones no tiene filas guardadas, y tratar eso como
 *    "no quiere nada" dejaria sin avisar precisamente a quien no ha tocado
 *    ningun ajuste — que es la mayoria. Solo un `enabled: false` explicito
 *    silencia un canal.
 *
 * 2. **Nunca lanza.** Se invoca desde dentro de la transaccion que reasigna un
 *    caso o que detecta un SLA vencido. Que fallar al avisar tumbase esa
 *    operacion seria invertir la importancia de las dos cosas: la reasignacion
 *    es el hecho, el aviso es su eco.
 */
export function createDispatchNotificationUseCase(deps: DispatchNotificationDeps) {
  return async function dispatchNotification(
    input: DispatchNotificationInput,
  ): Promise<readonly Notification[]> {
    const channels = input.channels ?? (['IN_APP'] as const);
    const delivered: Notification[] = [];

    try {
      const organizationId = createOrganizationId(input.organizationId);
      const recipientUserId = createUserId(input.recipientUserId);
      const alertType = createAlertType(input.alertType);
      const now = deps.clock.now();

      for (const channel of channels) {
        // La bandeja del panel no es silenciable (ver `CONFIGURABLE_CHANNELS`):
        // sin constancia de aviso, "no me enteré" deja de ser verificable.
        if (channel !== 'IN_APP') {
          const preference = await deps.preferences.findOne(
            organizationId,
            recipientUserId,
            alertType,
            channel,
            input.tx,
          );

          // Solo un `false` explicito silencia. Ver el comentario de arriba.
          if (preference && !preference.enabled) continue;
        }

        const notification = Notification.create({
          id: deps.generateNotificationId(),
          organizationId,
          recipientUserId,
          alertType,
          channel,
          title: input.title,
          body: input.body,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          now,
        });

        await deps.notifications.save(notification, input.tx);
        delivered.push(notification);
      }
    } catch (error) {
      console.warn(
        `[notifications] no se pudo avisar a ${input.recipientUserId} (${input.alertType}): ${(error as Error).message}`,
      );
    }

    return delivered;
  };
}

export type DispatchNotificationService = ReturnType<typeof createDispatchNotificationUseCase>;
