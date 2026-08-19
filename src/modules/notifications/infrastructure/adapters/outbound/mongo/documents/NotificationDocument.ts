/**
 * Mongo document shape for `Notifications`. `_id` is the aggregate's branded
 * `NotificationId` stored as a native `ObjectId`.
 *
 * `ReadAt` es la fecha de lectura en ISO, y `null` mientras no se haya leido:
 * el estado de lectura NO se duplica en un booleano aparte, para que no puedan
 * contradecirse.
 */

import type { ObjectId } from 'mongodb';

export interface NotificationDocument {
  readonly _id: ObjectId;
  readonly OrganizationId: string;
  readonly RecipientUserId: string;
  readonly AlertType: string;
  readonly Channel: string;
  readonly Title: string;
  readonly Body: string;
  readonly ResourceType: string | null;
  readonly ResourceId: string | null;
  readonly ReadAt: string | null;
  readonly CreatedAt: string;
  /** Espejo BSON de `CreatedAt` para ordenar y para el indice TTL. */
  readonly CreatedAtDate: Date;
}
