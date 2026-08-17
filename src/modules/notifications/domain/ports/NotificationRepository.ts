import type { Notification } from '../model/aggregates/Notification.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Port for `Notification` persistence. Append-only — `save` is a single
 * insert path (design D2: no upsert, no mutators, notifications are
 * write-once rows), threading `tx` so the write commits atomically with the
 * caller's transaction (e.g. `ReassignCase`'s `withTransaction`).
 */
export interface NotificationRepository {
  save(notification: Notification, tx?: Transaction): Promise<void>;
}
