import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseReport, CaseReportSnapshot } from '../domain/model/aggregates/CaseReport.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineReader } from '../domain/ports/TimelineReader.js';
import type { CaseNoteRepository } from '../domain/ports/CaseNoteRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { ResolutionRepository } from '../domain/ports/ResolutionRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { CaseReportRepository } from '../domain/ports/CaseReportRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { CaseReportId } from '../domain/model/value-objects/CaseReportId.js';
import { CaseReport as CaseReportAggregate } from '../domain/model/aggregates/CaseReport.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GenerateCaseReportInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface GenerateCaseReportDeps {
  readonly cases: CaseRepository;
  readonly timelineReader: TimelineReader;
  readonly notes: CaseNoteRepository;
  readonly investigations: InvestigationRepository;
  readonly resolutions: ResolutionRepository;
  readonly enforcementActions: EnforcementActionRepository;
  readonly analystDecisions: AnalystDecisionRepository;
  readonly reports: CaseReportRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseReportId: () => CaseReportId;
}

/**
 * Generates and persists an immutable snapshot of the full case graph (detail
 * + timeline + notes + investigations + resolutions + enforcement + analyst
 * decisions) at time T. Any authenticated tenant actor may generate one; the
 * case must belong to the actor's org and not be soft-deleted. The snapshot is
 * assembled from domain getters (no HTTP-layer mapper import — eslint
 * boundaries) and frozen — the case keeps mutating, the report does not.
 */
export function createGenerateCaseReportUseCase(deps: GenerateCaseReportDeps) {
  return async function generateCaseReport(input: GenerateCaseReportInput): Promise<CaseReport> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase = await deps.cases.findById(caseId, tx);
      if (kase === null || kase.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (kase.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }

      const [timeline, notes, investigations, resolutions, enforcementActions, analystDecisions] =
        await Promise.all([
          deps.timelineReader.listByCaseId(caseId, tx),
          deps.notes.listByCaseId(caseId, tx),
          deps.investigations.listByCaseId(caseId, tx),
          deps.resolutions.listByCaseId(caseId, tx),
          deps.enforcementActions.findByCaseId(caseId, tx),
          deps.analystDecisions.findByCaseId(caseId, tx),
        ]);

      const now = deps.clock.now();
      const snapshot: CaseReportSnapshot = {
        generatedAt: now,
        case: caseSnapshot(kase),
        timeline: timeline.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          previousValue: event.previousValue,
          newValue: event.newValue,
          createdBy: event.createdBy,
          createdAt: event.createdAt,
        })),
        notes: notes.map((note) => ({
          id: note.id,
          authorId: note.authorId,
          body: note.body,
          createdAt: note.createdAt,
        })),
        investigations: investigations.map((investigation) => ({
          id: investigation.id,
          subjectType: investigation.subjectType,
          subjectId: investigation.subjectId,
          status: investigation.status,
          findings: investigation.findings,
          openedBy: investigation.openedBy,
          createdAt: investigation.createdAt,
          closedAt: investigation.closedAt,
        })),
        resolutions: resolutions.map((resolution) => ({
          id: resolution.id,
          closureType: resolution.closureType,
          reason: resolution.reason,
          resolvedBy: resolution.resolvedBy,
          createdAt: resolution.createdAt,
        })),
        enforcementActions: enforcementActions.map((action) => ({
          id: action.id,
          actionType: action.actionType,
          targetType: action.targetType,
          targetId: action.targetId,
          status: action.status,
          createdBy: action.createdBy,
          createdAt: action.createdAt,
        })),
        analystDecisions: analystDecisions.map((decision) => ({
          id: decision.id,
          decision: decision.decision,
          confidence: decision.confidence,
          comment: decision.comment,
          createdBy: decision.createdBy,
          createdAt: decision.createdAt,
        })),
      };

      const report = CaseReportAggregate.create({
        id: deps.generateCaseReportId(),
        caseId,
        organizationId,
        generatedBy: input.auth.userId,
        snapshot,
        now,
      });
      await deps.reports.save(report, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'GENERATE_CASE_REPORT',
          resource: 'report',
          resourceId: report.id,
          detail: { caseId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return report;
    });
  };
}

function caseSnapshot(kase: Case): Readonly<Record<string, unknown>> {
  return {
    id: kase.id,
    status: kase.status,
    priority: kase.priority,
    riskScore: kase.riskScore,
    customerId: kase.customerId,
    assignedTo: kase.assignedTo ? { type: kase.assignedTo.type, id: kase.assignedTo.id } : null,
    dueDate: kase.dueDate,
    tags: kase.tags,
    createdAt: kase.createdAt,
    updatedAt: kase.updatedAt,
  };
}
