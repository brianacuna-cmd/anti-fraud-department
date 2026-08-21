import type { AnalystDecision } from '../../../../../domain/model/aggregates/AnalystDecision.js';
import type { EnforcementAction } from '../../../../../domain/model/aggregates/EnforcementAction.js';
import type { ApprovalRequest } from '../../../../../domain/model/aggregates/ApprovalRequest.js';
import type { CustomerOutgoingEvent } from '../../../../../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { RecordAnalystDecisionResult } from '../../../../../application/RecordAnalystDecision.js';
import type { ApproveEnforcementActionResult } from '../../../../../application/ApproveEnforcementAction.js';
import type { RejectEnforcementActionResult } from '../../../../../application/RejectEnforcementAction.js';
import type { ExecuteEnforcementActionResult } from '../../../../../application/ExecuteEnforcementAction.js';
import type { PendingApproval } from '../../../../../application/ListApprovalRequests.js';

export interface AnalystDecisionResponseDto {
  readonly id: string;
  readonly caseId: string;
  readonly organizationId: string;
  readonly decision: string;
  readonly confidence: number;
  readonly comment: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface EnforcementActionResponseDto {
  readonly id: string;
  readonly caseId: string;
  readonly organizationId: string;
  readonly analystDecisionId: string;
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly status: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApprovalRequestResponseDto {
  readonly id: string;
  readonly enforcementActionId: string;
  readonly requesterId: string;
  readonly reviewerId: string | null;
  readonly status: string;
  readonly reviewerComment: string | null;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
}

export interface RecordAnalystDecisionResponseDto {
  readonly decision: AnalystDecisionResponseDto;
  readonly enforcementAction: EnforcementActionResponseDto | null;
  /** La solicitud de doble firma abierta con la sancion (ENF-002). */
  readonly approvalRequest: ApprovalRequestResponseDto | null;
  readonly caseStatus: string;
}

export interface ReviewEnforcementActionResponseDto {
  readonly enforcementAction: EnforcementActionResponseDto;
  readonly approvalRequest: ApprovalRequestResponseDto;
}

export interface CustomerOutgoingEventResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly enforcementActionId: string;
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly payload: {
    readonly enforcement_action_id: string;
    readonly case_id: string;
    readonly action_type: string;
    readonly target_type: string;
    readonly target_id: string;
    readonly organization_id: string;
  };
  readonly status: string;
  readonly responseStatus: number | null;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly createdAt: string;
}

export interface ExecuteEnforcementActionResponseDto {
  readonly enforcementAction: EnforcementActionResponseDto;
  readonly outgoingEvent: CustomerOutgoingEventResponseDto | null;
}

export function toAnalystDecisionResponse(decision: AnalystDecision): AnalystDecisionResponseDto {
  return {
    id: decision.id,
    caseId: decision.caseId,
    organizationId: decision.organizationId,
    decision: decision.decision,
    confidence: decision.confidence,
    comment: decision.comment,
    createdBy: decision.createdBy,
    createdAt: decision.createdAt,
  };
}

export function toEnforcementActionResponse(action: EnforcementAction): EnforcementActionResponseDto {
  return {
    id: action.id,
    caseId: action.caseId,
    organizationId: action.organizationId,
    analystDecisionId: action.analystDecisionId,
    actionType: action.actionType,
    targetType: action.targetType,
    targetId: action.targetId,
    status: action.status,
    createdBy: action.createdBy,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

export function toApprovalRequestResponse(request: ApprovalRequest): ApprovalRequestResponseDto {
  return {
    id: request.id,
    enforcementActionId: request.enforcementActionId,
    requesterId: request.requesterId,
    reviewerId: request.reviewerId,
    status: request.status,
    reviewerComment: request.reviewerComment,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
  };
}

export interface PendingApprovalResponseDto {
  readonly approvalRequest: ApprovalRequestResponseDto;
  readonly enforcementAction: EnforcementActionResponseDto;
  readonly reviewableByCaller: boolean;
}

export function toPendingApprovalResponse(entry: PendingApproval): PendingApprovalResponseDto {
  return {
    approvalRequest: toApprovalRequestResponse(entry.approvalRequest),
    enforcementAction: toEnforcementActionResponse(entry.enforcementAction),
    reviewableByCaller: entry.reviewableByCaller,
  };
}

export function toRecordAnalystDecisionResponse(
  result: RecordAnalystDecisionResult,
): RecordAnalystDecisionResponseDto {
  return {
    decision: toAnalystDecisionResponse(result.decision),
    enforcementAction:
      result.enforcementAction === null ? null : toEnforcementActionResponse(result.enforcementAction),
    approvalRequest:
      result.approvalRequest === null ? null : toApprovalRequestResponse(result.approvalRequest),
    caseStatus: result.caseStatus,
  };
}

export function toReviewEnforcementActionResponse(
  result: ApproveEnforcementActionResult | RejectEnforcementActionResult,
): ReviewEnforcementActionResponseDto {
  return {
    enforcementAction: toEnforcementActionResponse(result.enforcementAction),
    approvalRequest: toApprovalRequestResponse(result.approvalRequest),
  };
}

export function toCustomerOutgoingEventResponse(
  event: CustomerOutgoingEvent,
): CustomerOutgoingEventResponseDto {
  return {
    id: event.id,
    organizationId: event.organizationId,
    customerId: event.customerId,
    enforcementActionId: event.enforcementActionId,
    webhookUrl: event.webhookUrl,
    eventType: event.eventType,
    payload: event.payload,
    status: event.status,
    responseStatus: event.responseStatus,
    attempts: event.attempts,
    lastAttemptAt: event.lastAttemptAt,
    createdAt: event.createdAt,
  };
}

export function toExecuteEnforcementActionResponse(
  result: ExecuteEnforcementActionResult,
): ExecuteEnforcementActionResponseDto {
  return {
    enforcementAction: toEnforcementActionResponse(result.enforcementAction),
    outgoingEvent:
      result.outgoingEvent === null ? null : toCustomerOutgoingEventResponse(result.outgoingEvent),
  };
}
