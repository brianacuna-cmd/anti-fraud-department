import type { Transaction } from './UnitOfWork.js';

export interface CaseNotification {
  readonly organizationId: string;
  readonly recipientUserId: string;
  /** Tipo del catalogo cerrado de `notifications` (p. ej. CASE_ASSIGNED). */
  readonly alertType: string;
  readonly title: string;
  readonly body: string;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
}

/**
 * Puerto propio de case-management para avisar a una persona.
 *
 * Declarado aqui y no importado del modulo `notifications` por la misma razon
 * que `AuditRecorder`: un modulo no depende de otro, y el puente se monta en
 * la raiz de composicion.
 *
 * `notify` NO devuelve nada ni falla: avisar es el eco de un hecho, no el
 * hecho. Si el aviso no sale, la reasignacion o el vencimiento que lo motivo
 * siguen siendo ciertos y deben persistir igual.
 */
export interface Notifier {
  notify(notification: CaseNotification, tx?: Transaction): Promise<void>;
}
