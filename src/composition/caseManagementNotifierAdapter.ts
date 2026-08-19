import type { CaseNotification, Notifier } from '../modules/case-management/domain/ports/Notifier.js';
import type { Transaction as CaseManagementTransaction } from '../modules/case-management/domain/ports/UnitOfWork.js';
import type { DispatchNotificationService } from '../modules/notifications/application/DispatchNotification.js';
import type { Transaction as NotificationsTransaction } from '../modules/notifications/domain/ports/UnitOfWork.js';

/**
 * Puente de la raiz de composicion (gemelo exacto de
 * `caseManagementAuditRecorderAdapter`): implementa el puerto `Notifier` de
 * case-management delegando en el caso de uso `DispatchNotification` del
 * modulo `notifications`.
 *
 * Vive FUERA de las carpetas `domain`/`application`/`infrastructure` de todo
 * modulo, que es la unica costura donde `eslint-plugin-boundaries` admite un
 * import cruzado.
 *
 * `tx` es el `Transaction` opaco de case-management y `dispatchNotification`
 * espera el de notifications. En tiempo de ejecucion ambos son el mismo
 * `ClientSession`: este es el cast documentado que une los dos tipos
 * nominales, igual que en el adaptador de auditoria.
 */
export function createCaseManagementNotifierAdapter(
  dispatchNotification: DispatchNotificationService,
): Notifier {
  return {
    async notify(notification: CaseNotification, tx?: CaseManagementTransaction): Promise<void> {
      await dispatchNotification({
        organizationId: notification.organizationId,
        recipientUserId: notification.recipientUserId,
        alertType: notification.alertType,
        title: notification.title,
        body: notification.body,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        tx: tx as unknown as NotificationsTransaction | undefined,
      });
    },
  };
}
