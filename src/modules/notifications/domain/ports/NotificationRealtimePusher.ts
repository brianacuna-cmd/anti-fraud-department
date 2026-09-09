import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { UserId } from '../model/value-objects/UserId.js';
import type { AlertType } from '../model/value-objects/AlertType.js';

export interface NotificationRealtimeInput {
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly context: Record<string, unknown>;
}

/**
 * Outbound port for pushing a notification event to a live WebSocket
 * connection in real time (realtime-ws-gateway design §2). Mirrors
 * `NotificationEmailSender` on purpose: the two ports are structurally
 * identical but kept as separate named types so each transport evolves
 * independently. Delivery is best-effort: `SendNotification` treats a
 * thrown error as a non-fatal, observable failure — the in-app row is the
 * source of truth and the caller's transaction is never rolled back by a
 * realtime push failure.
 */
export interface NotificationRealtimePusher {
  send(input: NotificationRealtimeInput): Promise<void>;
}
