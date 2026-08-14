import type { AnalystDecision } from '../../../../../domain/model/aggregates/AnalystDecision.js';
import type { EnforcementAction } from '../../../../../domain/model/aggregates/EnforcementAction.js';
import type { RecordAnalystDecisionResult } from '../../../../../application/RecordAnalystDecision.js';

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

export interface RecordAnalystDecisionResponseDto {
  readonly decision: AnalystDecisionResponseDto;
  readonly enforcementAction: EnforcementActionResponseDto | null;
  readonly caseStatus: string;
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

export function toRecordAnalystDecisionResponse(
  result: RecordAnalystDecisionResult,
): RecordAnalystDecisionResponseDto {
  return {
    decision: toAnalystDecisionResponse(result.decision),
    enforcementAction:
      result.enforcementAction === null ? null : toEnforcementActionResponse(result.enforcementAction),
    caseStatus: result.caseStatus,
  };
}
