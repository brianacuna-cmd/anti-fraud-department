import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { NotificationSender } from '../domain/ports/NotificationSender.js';

/** Quien revisa las sanciones. Ver `authorization/policy.ts`. */
export const APPROVER_ROLE = 'SUPERVISOR';

export interface NotifyApproversDeps {
  readonly notificationSender: NotificationSender;
  readonly assigneeDirectory: AssigneeDirectory;
}

export interface NotifyApproversInput {
  readonly organizationId: string;
  readonly requesterId: string;
  readonly caseId: string;
  readonly enforcementActionId: string;
  readonly approvalRequestId: string;
  readonly actionType: string;
  readonly tx: Parameters<NotificationSender['send']>[1];
}

/**
 * Avisa a los supervisores de que hay una sanción esperando doble firma.
 *
 * Se excluye al solicitante aunque sea supervisor: el agregado le va a negar
 * la revisión de todos modos (cuatro ojos), así que avisarle solo sería
 * ofrecerle algo que no puede hacer.
 *
 * Va DENTRO de la transacción, como en `ReassignCase`: si la sanción se
 * guarda y el aviso no, la cola queda con trabajo que nadie sabe que existe.
 *
 * Vive aquí y no dentro de `RecordAnalystDecision` porque desde ENF-001 hay
 * dos puertas por las que nace una sanción —el dictamen y la solicitud
 * suelta— y las dos tienen que abrir la misma cola. Duplicar el aviso era
 * garantizar que un día solo una de las dos avisara.
 */
export async function notifyApprovers(
  deps: NotifyApproversDeps,
  input: NotifyApproversInput,
): Promise<void> {
  const approvers = await deps.assigneeDirectory.listRoleRecipients(
    input.organizationId,
    APPROVER_ROLE,
  );

  const recipients = approvers.filter((recipientUserId) => recipientUserId !== input.requesterId);
  for (const recipientUserId of recipients) {
    await deps.notificationSender.send(
      {
        organizationId: input.organizationId,
        recipientUserId,
        alertType: 'APROBACION_PENDIENTE',
        context: {
          caseId: input.caseId,
          enforcementActionId: input.enforcementActionId,
          approvalRequestId: input.approvalRequestId,
          actionType: input.actionType,
          requesterId: input.requesterId,
        },
      },
      input.tx,
    );
  }
}
