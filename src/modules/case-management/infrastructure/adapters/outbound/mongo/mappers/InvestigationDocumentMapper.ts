import { ObjectId } from 'mongodb';
import { fromDate, toDate, type Instant } from '../../../../../../../shared/time/Instant.js';
import { Investigation } from '../../../../../domain/model/aggregates/Investigation.js';
import { createInvestigationId } from '../../../../../domain/model/value-objects/InvestigationId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createInvestigationSubjectType } from '../../../../../domain/model/value-objects/InvestigationSubjectType.js';
import { createInvestigationStatus } from '../../../../../domain/model/value-objects/InvestigationStatus.js';
import type { InvestigationDocument } from '../documents/InvestigationDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(investigation: Investigation): InvestigationDocument {
  return {
    _id: new ObjectId(investigation.id),
    case_id: new ObjectId(investigation.caseId),
    organization_id: new ObjectId(investigation.organizationId),
    subject_type: investigation.subjectType,
    subject_id: investigation.subjectId,
    status: investigation.status,
    findings: investigation.findings,
    findings_data: investigation.findingsData,
    exploration_depth: investigation.explorationDepth,
    opened_by: investigation.openedBy,
    linked_case_ids: investigation.linkedCaseIds.map((id) => new ObjectId(id)),
    created_at: toDate(investigation.createdAt),
    updated_at: toDate(investigation.updatedAt),
    closed_at: investigation.closedAt === null ? null : toDate(investigation.closedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: InvestigationDocument): Investigation {
  const closedAt: Instant | null = document.closed_at === null ? null : fromDate(document.closed_at);
  return Investigation.rehydrate({
    id: createInvestigationId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    organizationId: document.organization_id.toString(),
    subjectType: createInvestigationSubjectType(document.subject_type),
    subjectId: document.subject_id,
    status: createInvestigationStatus(document.status),
    findings: document.findings,
    findingsData: document.findings_data ?? null,
    explorationDepth: document.exploration_depth ?? null,
    openedBy: document.opened_by,
    linkedCaseIds: (document.linked_case_ids ?? []).map((id) => createCaseId(id.toString())),
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
    closedAt,
  });
}
