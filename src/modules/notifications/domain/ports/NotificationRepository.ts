import type { Notification } from '../model/aggregates/Notification.js';
import type { NotificationId } from '../model/value-objects/NotificationId.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { UserId } from '../model/value-objects/UserId.js';
import type { Transaction } from './UnitOfWork.js';

export interface NotificationListPage {
  readonly items: readonly Notification[];
  readonly unreadCount: number;
}

/**
 * Puerto de persistencia de `Notification` (la entrega, no la preferencia).
 *
 * `listForUser` devuelve tambien el numero de no leidos porque la interfaz los
 * pide siempre juntos: el contador del icono y la lista salen de la misma
 * pantalla, y separarlos en dos consultas los dejaria desincronizados en el
 * intervalo entre ambas.
 */
export interface NotificationRepository {
  save(notification: Notification, tx?: Transaction): Promise<void>;
  findById(id: NotificationId, tx?: Transaction): Promise<Notification | null>;
  listForUser(
    organizationId: OrganizationId,
    userId: UserId,
    options?: { readonly limit?: number; readonly unreadOnly?: boolean },
    tx?: Transaction,
  ): Promise<NotificationListPage>;
}
