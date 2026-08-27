import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { CaseManagementErrorCode } from './CaseManagementErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `case-management`
 * module (mirrors `IdentityAccessError`). HTTP status mapping lives in the
 * HTTP layer (`infrastructure/adapters/inbound/http/errorStatus.ts`), never
 * here.
 */
export class CaseManagementError extends DomainError {
  constructor(
    code: CaseManagementErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): CaseManagementError {
  return new CaseManagementError('INVARIANT_VIOLATION', message, metadata);
}

export function invalidTransition(current: string, next: string): CaseManagementError {
  return new CaseManagementError(
    'INVALID_TRANSITION',
    `cannot transition from "${current}" to "${next}"`,
    { current, next },
  );
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): CaseManagementError {
  return new CaseManagementError('FORBIDDEN_CROSS_TENANT', message);
}

export function forbiddenRole(
  roleId: string | null,
  allowed: readonly string[],
): CaseManagementError {
  return new CaseManagementError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

/**
 * The actor belongs to the governance plane (`ORGANIZATION`, `ADMIN`,
 * `AUDITOR`): they observe the whole tenant and do not operate on it.
 *
 * Separated from `forbiddenRole` because the message is the only thing that
 * reaches the screen: `role "null" is not authorized` does not tell anyone
 * that their access is read-only by design, nor whom they must ask to
 * perform the action.
 */
export function forbiddenReadOnly(
  auth: { readonly actorType: string; readonly roleId: string | null },
  allowed: readonly string[],
): CaseManagementError {
  const actor = auth.actorType === 'USER' ? (auth.roleId ?? 'null') : auth.actorType;
  return new CaseManagementError(
    'FORBIDDEN_ROLE',
    `"${actor}" has read-only access to case management; this operation requires one of: ${allowed.join(', ')}`,
    { actor, allowed: [...allowed], readOnly: true },
  );
}

/**
 * Four-eyes principle: whoever requests a sanction cannot authorize it.
 *
 * Own code and not `FORBIDDEN_ROLE` because this is not a role problem — the
 * supervisor who requested it DOES have the role to approve. What fails is
 * the separation between who proposes and who reviews, and whoever receives
 * this needs to understand that the action is not theirs, but another
 * person's.
 */
export function selfApprovalForbidden(
  requesterId: string,
  approvalRequestId: string,
): CaseManagementError {
  return new CaseManagementError(
    'SELF_APPROVAL_FORBIDDEN',
    'the requester of an enforcement action cannot review it: dual control requires a second person',
    { requesterId, approvalRequestId },
  );
}

export function organizationFraudConfigNotFound(organizationId: string): CaseManagementError {
  return new CaseManagementError(
    'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND',
    `no OrganizationFraudConfig exists for organization "${organizationId}"`,
    { organizationId },
  );
}

export function caseNotFound(caseId: string): CaseManagementError {
  return new CaseManagementError('CASE_NOT_FOUND', `case "${caseId}" was not found`, { caseId });
}

export function enforcementActionNotFound(enforcementActionId: string): CaseManagementError {
  return new CaseManagementError(
    'ENFORCEMENT_ACTION_NOT_FOUND',
    `enforcement action "${enforcementActionId}" was not found`,
    { enforcementActionId },
  );
}

export function routingRuleNotFound(ruleId: string): CaseManagementError {
  return new CaseManagementError(
    'ROUTING_RULE_NOT_FOUND',
    `routing rule "${ruleId}" was not found`,
    { ruleId },
  );
}

export function investigationNotFound(investigationId: string): CaseManagementError {
  return new CaseManagementError(
    'INVESTIGATION_NOT_FOUND',
    `investigation "${investigationId}" was not found`,
    { investigationId },
  );
}

export function caseReportNotFound(reportId: string): CaseManagementError {
  return new CaseManagementError('CASE_REPORT_NOT_FOUND', `case report "${reportId}" was not found`, {
    reportId,
  });
}

export function evidenceNotFound(evidenceId: string): CaseManagementError {
  return new CaseManagementError('EVIDENCE_NOT_FOUND', `evidence "${evidenceId}" was not found`, {
    evidenceId,
  });
}

export function caseNoteNotFound(noteId: string): CaseManagementError {
  return new CaseManagementError('CASE_NOTE_NOT_FOUND', `case note "${noteId}" was not found`, {
    noteId,
  });
}

export function approvalRequestNotFound(approvalRequestId: string): CaseManagementError {
  return new CaseManagementError(
    'APPROVAL_REQUEST_NOT_FOUND',
    `approval request "${approvalRequestId}" was not found`,
    { approvalRequestId },
  );
}

/**
 * INV-015: the antivirus recognized malware. The signature is named because
 * the analyst needs to know WHAT was detected —a false positive from a PDF
 * with macros is not treated the same as a trojan— and because without it
 * the rejection is indistinguishable from a system failure.
 */
export function evidenceInfected(filename: string, signature: string): CaseManagementError {
  return new CaseManagementError(
    'EVIDENCE_INFECTED',
    `evidence "${filename}" was rejected by the malware scanner: ${signature}`,
    { filename, signature },
  );
}

/**
 * A case with no assignee is frozen.
 *
 * The rule exists so that no case advances while nobody is accountable for
 * it: a case that is worked, decided, and closed without a record of who
 * carried it is exactly the one that cannot be defended later.
 */
export function caseNotAssigned(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_NOT_ASSIGNED',
    'the case has no assignee: it must be assigned before it can be worked',
    { caseId },
  );
}

/**
 * A closed case is no longer worked.
 *
 * The message names the way out —reopen— because whoever receives this
 * error almost always has the permission and only needs to know there is a
 * prior step.
 */
export function caseClosed(caseId: string, status: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_CLOSED',
    `the case is ${status.toLowerCase()}: reopen it before working on it again`,
    { caseId, status },
  );
}

/**
 * Instruction (notes, evidence) requires the case to already be `IN_REVIEW`.
 * Named after the step it is missing, like `caseNotAssigned`/`caseClosed`.
 */
export function caseNotReviewed(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_NOT_REVIEWED',
    'the case has not entered review yet: start the review before adding notes or evidence',
    { caseId },
  );
}

/** A decision needs at least one note or one piece of evidence behind it. */
export function caseNotInstructed(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_NOT_INSTRUCTED',
    'the case has no notes or evidence yet: instruct it before recording a decision',
    { caseId },
  );
}

/** Closing a case requires at least one analyst decision on file. */
export function caseNotDecided(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_NOT_DECIDED',
    'the case has no analyst decision yet: record one before resolving',
    { caseId },
  );
}

/** A FRAUD_CONFIRMED decision exists with no enforcement action requested yet. */
export function caseEnforcementPending(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_ENFORCEMENT_PENDING',
    'the case has a fraud-confirmed decision with no enforcement action requested yet',
    { caseId },
  );
}

/** The report/dossier freezes the full case file — the case must be closed first. */
export function caseNotResolvedForReport(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_NOT_RESOLVED_FOR_REPORT',
    'the case is not resolved yet: resolve or archive it before generating its report',
    { caseId },
  );
}

/**
 * No assignee was chosen and there is no active routing rule to fall back
 * on: creating the case now would leave it permanently orphaned. The
 * message names both ways out because either one resolves it.
 */
export function noActiveRoutingRule(organizationId: string): CaseManagementError {
  return new CaseManagementError(
    'NO_ACTIVE_ROUTING_RULE',
    'no assignee was chosen and the organization has no active routing rule: pick an assignee or configure one first',
    { organizationId },
  );
}

export function dlqEventNotFound(dlqEventId: string): CaseManagementError {
  return new CaseManagementError(
    'DLQ_EVENT_NOT_FOUND',
    `no dead-letter event with id "${dlqEventId}" was found`,
    { dlqEventId },
  );
}

export function webhookSubscriptionNotFound(subscriptionId: string): CaseManagementError {
  return new CaseManagementError(
    'WEBHOOK_SUBSCRIPTION_NOT_FOUND',
    `webhook subscription "${subscriptionId}" was not found`,
    { subscriptionId },
  );
}

export function webhookSubscriptionUrlTaken(url: string): CaseManagementError {
  return new CaseManagementError(
    'WEBHOOK_SUBSCRIPTION_URL_TAKEN',
    `webhook subscription URL "${url}" is already in use`,
    { url },
  );
}
