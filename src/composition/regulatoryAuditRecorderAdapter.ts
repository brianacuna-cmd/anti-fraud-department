import type { AuditEvent, AuditRecorder } from '../modules/regulatory/domain/ports/AuditRecorder.js';
import type { Transaction as RegulatoryTransaction } from '../modules/regulatory/domain/ports/UnitOfWork.js';
import type { createRecordAuditLogUseCase } from '../modules/audit/application/RecordAuditLog.js';
import type { Transaction as AuditTransaction } from '../modules/audit/domain/ports/UnitOfWork.js';

/**
 * Puente en la raíz de composición (gemelo de `privacyAuditRecorderAdapter.ts`):
 * implementa el puerto `AuditRecorder` propio de `regulatory` delegando en el
 * caso de uso `RecordAuditLog` del módulo `audit`. Este fichero vive FUERA de
 * las carpetas de cualquier módulo — la única costura donde `eslint-plugin-
 * boundaries` permite un import cruzado.
 */
export function createRegulatoryAuditRecorderAdapter(
  recordAuditLog: ReturnType<typeof createRecordAuditLogUseCase>,
): AuditRecorder {
  return {
    async record(event: AuditEvent, tx?: RegulatoryTransaction): Promise<void> {
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
