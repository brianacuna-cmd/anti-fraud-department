import type { Transaction } from './UnitOfWork.js';

/**
 * case-management's OWN mirror of the `notifications` module's closed
 * `AlertType` catalog (design: `case-management/domain/ports/NotificationSender.ts`).
 * `eslint-plugin-boundaries` forbids importing another module's `domain`
 * types, so this literal union is duplicated here rather than imported —
 * it MUST be kept in sync with `notifications/domain/model/value-objects/AlertType.ts`.
 */
export type CaseManagementAlertType = 'CASO_ASIGNADO' | 'SLA_POR_VENCER' | 'APROBACION_PENDIENTE' | 'RIESGO_CRITICO';

export interface NotificationRequest {
  readonly organizationId: string;
  readonly recipientUserId: string;
  readonly alertType: CaseManagementAlertType;
  readonly context: Record<string, unknown>;
}

/**
 * Inverted port (exact structural twin of `AuditRecorder` — design D5):
 * case-management's `application` layer depends only on this port (its own
 * module's `domain`), never on the `notifications` module directly. The
 * composition root (`main.ts` + `caseManagementNotificationSenderAdapter.ts`)
 * is the ONLY place a concrete implementation is constructed, bridging to
 * the `notifications` module's `SendNotification` use case.
 *
 * `tx` is case-management's OWN opaque `Transaction`, threaded through
 * `withTransaction` so the notification row commits atomically with the
 * triggering business write.
 */
export interface NotificationSender {
  send(request: NotificationRequest, tx?: Transaction): Promise<void>;
}
