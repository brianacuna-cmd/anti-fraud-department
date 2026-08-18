import type { Investigation } from '../../../../../domain/model/aggregates/Investigation.js';

export interface InvestigationDto {
  readonly id: string;
  readonly caseId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly status: string;
  readonly findings: string | null;
  readonly openedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
}

export function toInvestigationResponse(investigation: Investigation): InvestigationDto {
  return {
    id: investigation.id,
    caseId: investigation.caseId,
    subjectType: investigation.subjectType,
    subjectId: investigation.subjectId,
    status: investigation.status,
    findings: investigation.findings,
    openedBy: investigation.openedBy,
    createdAt: investigation.createdAt,
    updatedAt: investigation.updatedAt,
    closedAt: investigation.closedAt,
  };
}
