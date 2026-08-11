import type { AuditEvent, AuditRecorder } from '../modules/notifications/domain/ports/AuditRecorder.js';
import type { Transaction as NotificationsTransaction } from '../modules/notifications/domain/ports/UnitOfWork.js';
import type { createRecordAuditLogUseCase } from '../modules/audit/application/RecordAuditLog.js';
import type { Transaction as AuditTransaction } from '../modules/audit/domain/ports/UnitOfWork.js';

/**
 * Composition-root bridge for the `notifications` module — the exact twin of
 * `src/composition/auditRecorderAdapter.ts` (identity-access's bridge).
 * Implements notifications' OWN `AuditRecorder` port by delegating to the
 * `audit` module's `RecordAuditLog` use case. This file lives OUTSIDE every
 * module's `domain`/`application`/`infrastructure` folders (like `main.ts`
 * itself) — it is the one legal seam where a cross-module import
 * (notifications' port depending on the audit module's use case) is allowed
 * by `eslint-plugin-boundaries`.
 *
 * `tx` is notifications' OWN opaque `Transaction`; `recordAuditLog` wants the
 * `audit` module's OWN opaque `Transaction`. Both are the same runtime
 * `ClientSession` — this is the SINGLE documented cast that bridges the two
 * nominal types, matching the identity-access precedent.
 */
export function createNotificationsAuditRecorderAdapter(
  recordAuditLog: ReturnType<typeof createRecordAuditLogUseCase>,
): AuditRecorder {
  return {
    async record(event: AuditEvent, tx?: NotificationsTransaction): Promise<void> {
      await recordAuditLog(
        {
          organizationId: event.organizationId,
          actorType: event.actorType,
          actorId: event.actorId,
          action: event.action,
          resource: event.resource,
          resourceId: event.resourceId,
          detail: event.detail,
          ipAddress: event.ipAddress,
        },
        tx as unknown as AuditTransaction | undefined,
      );
    },
  };
}
