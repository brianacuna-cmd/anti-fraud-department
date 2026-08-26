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
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import { createAssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { CaseReportId } from '../domain/model/value-objects/CaseReportId.js';
import { CaseReport as CaseReportAggregate } from '../domain/model/aggregates/CaseReport.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { assertReadyForReport } from '../domain/services/WorkflowStepGate.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

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
  readonly evidence: EvidenceRepository;
  readonly approvalRequests: ApprovalRequestRepository;
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly assignees: AssigneeDirectory;
  readonly reports: CaseReportRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseReportId: () => CaseReportId;
}

/**
 * Generates and persists an immutable snapshot of the FULL case file at time
 * T: detail, frozen customer identity, SLA, timeline, notes, evidence (with
 * its hash and timestamp), investigations, decisions, sanctions, their
 * approvals, and the resolution.
 *
 * Three things that were previously missing and made the report unreadable as
 * a case file:
 *
 * - **The evidence.** A frozen case without the list of proofs —with their
 *   SHA-256 and timestamp— cannot attest to anything: that is exactly what a
 *   third party needs to check that the file you hand them is the one that
 *   was collected.
 * - **The approvals.** Without them there is no record of who authorized each
 *   sanction, which is half of four-eyes control.
 * - **The names.** The rest of the tables store ids; a report full of
 *   ObjectIds is unreadable. They are resolved HERE, at freeze time, and not
 *   when printing: that way the report still says who did what even if that
 *   person is later deleted. That is precisely what is expected of an
 *   immutable document.
 *
 * Any operational actor can generate it; the case must belong to their
 * organization, not be deleted, and already be RESOLVED/ARCHIVED — a report
 * is the frozen record of a case that finished, not a mid-work snapshot
 * (`WorkflowStepGate.assertReadyForReport`). The snapshot is built from the domain
 * getters (without importing HTTP mappers — eslint boundaries) and is then
 * frozen: the case keeps changing, the report does not.
 */
export function createGenerateCaseReportUseCase(deps: GenerateCaseReportDeps) {
  return async function generateCaseReport(input: GenerateCaseReportInput): Promise<CaseReport> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
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
      // The report freezes the FULL case file, resolution included. See `WorkflowStepGate`.
      assertReadyForReport(kase);

      const [
        timeline,
        notes,
        investigations,
        resolutions,
        enforcementActions,
        analystDecisions,
        evidence,
        sla,
      ] = await Promise.all([
        deps.timelineReader.listByCaseId(caseId, tx),
        deps.notes.listByCaseId(caseId, tx),
        deps.investigations.listByCaseId(caseId, tx),
        deps.resolutions.listByCaseId(caseId, tx),
        deps.enforcementActions.findByCaseId(caseId, tx),
        deps.analystDecisions.findByCaseId(caseId, tx),
        deps.evidence.listByCaseId(caseId, tx),
        deps.slaTracking.findByCaseId(caseId, tx),
      ]);

      // One approval per sanction: the row hangs off the sanction, not the case.
      const approvals = await Promise.all(
        enforcementActions.map(async (action) => ({
          action,
          approval: await deps.approvalRequests.findByEnforcementActionId(action.id, tx),
        })),
      );

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
        // Metadata, never the file: a report is an index of the chain of
        // custody, not an attachment. The SHA-256 is what later lets you
        // check that the delivered proof is the one that was collected.
        evidence: evidence.map((item) => ({
          id: item.id,
          filename: item.filename,
          contentType: item.contentType,
          byteSize: item.byteSize,
          sha256: item.sha256,
          timestamp: item.timestamp
            ? {
                authority: item.timestamp.authority,
                timestampedAt: item.timestamp.timestampedAt,
              }
            : null,
          // INV-015. It goes in the frozen report for the same reason as the
          // hash and timestamp: it is provenance of the proof. If in two years
          // someone asks what was checked on this file before accepting it,
          // the answer must be inside the snapshot, not in a live collection
          // that will have changed by then.
          scanStatus: item.scanStatus,
          uploadedBy: item.uploadedBy,
          createdAt: item.createdAt,
          deletedAt: item.deletedAt,
        })),
        // The other half of four-eyes control: who requested and who signed.
        approvals: approvals.flatMap(({ action, approval }) =>
          approval === null
            ? []
            : [
                {
                  id: approval.id,
                  enforcementActionId: action.id,
                  actionType: action.actionType,
                  status: approval.status,
                  requesterId: approval.requesterId,
                  reviewerId: approval.reviewerId,
                  reviewerComment: approval.reviewerComment,
                  createdAt: approval.createdAt,
                  reviewedAt: approval.reviewedAt,
                },
              ],
        ),
        sla:
          sla === null
            ? null
            : { dueDate: sla.dueDate, status: sla.status, updatedAt: sla.updatedAt },
        actors: await resolveActors(deps, organizationId, {
          kase,
          timeline,
          notes,
          investigations,
          resolutions,
          enforcementActions,
          analystDecisions,
          evidence,
          approvals,
          reportedBy: input.auth.userId,
        }),
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
    // Who the customer is, frozen. Without this the report identifies the
    // subject by a `customerId` that means nothing to someone reading from
    // outside, and that may also have stopped resolving to anything at the
    // provider.
    customer: {
      email: kase.customerEmail,
      bridgeUserId: kase.bridgeUserId,
      bridgeWallet: kase.bridgeWallet,
      stripeCustomerId: kase.stripeCustomerId,
      snapshot: kase.finturuCacheSnapshot,
    },
  };
}

/**
 * Names of every person who appears in the case, resolved at FREEZE time.
 *
 * They are stored inside the report and not resolved when printing for the
 * same reason the rest is frozen: a report from two years ago must still say
 * who closed the case even if that person no longer exists in the system.
 * An id that does not resolve simply stays out of the map, and whoever
 * reads it will show the raw id rather than an invented name.
 *
 * If the identity directory fails, the report is still generated without
 * names: losing the whole case because a name could not be attached would
 * be worse.
 */
/** Every person id that appears in the case, without duplicates. */
function collectUserIds(sources: ActorSources): Set<string> {
  const userIds = new Set<string>([sources.reportedBy]);
  const singles: readonly (string | null)[] = [
    ...sources.timeline.map((entry) => entry.createdBy),
    ...sources.notes.map((entry) => entry.authorId),
    ...sources.investigations.map((entry) => entry.openedBy),
    ...sources.resolutions.map((entry) => entry.resolvedBy),
    ...sources.enforcementActions.map((entry) => entry.createdBy),
    ...sources.analystDecisions.map((entry) => entry.createdBy),
    ...sources.evidence.map((entry) => entry.uploadedBy),
    ...sources.approvals.flatMap(({ approval }) =>
      approval === null ? [] : [approval.requesterId, approval.reviewerId],
    ),
  ];
  for (const id of singles) {
    if (id) userIds.add(id);
  }
  return userIds;
}

interface ActorSources {
  kase: Case;
  timeline: readonly { createdBy: string | null }[];
  notes: readonly { authorId: string | null }[];
  investigations: readonly { openedBy: string }[];
  resolutions: readonly { resolvedBy: string }[];
  enforcementActions: readonly { createdBy: string }[];
  analystDecisions: readonly { createdBy: string }[];
  evidence: readonly { uploadedBy: string }[];
  approvals: readonly { approval: { requesterId: string; reviewerId: string | null } | null }[];
  reportedBy: string;
}

async function resolveActors(
  deps: GenerateCaseReportDeps,
  organizationId: string,
  sources: ActorSources,
): Promise<Readonly<Record<string, string>>> {
  const userIds = collectUserIds(sources);
  const assignee = sources.kase.assignedTo;
  const targets = [...userIds].map((id) => createAssignedTo('USER', id));
  if (assignee !== null) {
    targets.push(createAssignedTo(assignee.type, assignee.id));
  }

  try {
    return Object.fromEntries(await deps.assignees.displayNames(organizationId, targets));
  } catch {
    return {};
  }
}
