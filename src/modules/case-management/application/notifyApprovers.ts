import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { NotificationSender } from '../domain/ports/NotificationSender.js';

/** Who reviews sanctions. See `authorization/policy.ts`. */
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
 * Notifies supervisors that a sanction is waiting for four-eyes.
 *
 * The requester is excluded even if they are a supervisor: the aggregate
 * will deny the review anyway (four-eyes), so notifying them would only
 * offer something they cannot do.
 *
 * Runs INSIDE the transaction, as in `ReassignCase`: if the sanction is
 * saved and the notice is not, the queue holds work nobody knows exists.
 *
 * Lives here and not inside `RecordAnalystDecision` because since ENF-001
 * there are two doors through which a sanction is born — the analyst
 * decision and the standalone request — and both must open the same
 * queue. Duplicating the notice would guarantee that one day only one of
 * the two would notify.
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
        alertType: 'APPROVAL_PENDING',
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
