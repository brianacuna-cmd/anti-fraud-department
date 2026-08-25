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
 * T: detalle, identidad congelada del cliente, SLA, cronologia, notas,
 * evidencia (con su hash y su sello), investigaciones, dictamenes, sanciones,
 * sus aprobaciones y la resolucion.
 *
 * Tres cosas que antes faltaban y hacian el informe ilegible como expediente:
 *
 * - **La evidencia.** Un expediente congelado sin la lista de pruebas —con su
 *   SHA-256 y su sello— no sirve para acreditar nada: es justo lo que un
 *   tercero necesita para comprobar que el fichero que le entregas es el que
 *   se recogio.
 * - **Las aprobaciones.** Sin ellas no consta quien autorizo cada sancion, que
 *   es la mitad del control de cuatro ojos.
 * - **Los nombres.** El resto de tablas guardan ids; un informe lleno de
 *   ObjectIds no lo lee nadie. Se resuelven AQUI, al congelar, y no al
 *   imprimirlo: asi el informe sigue diciendo quien hizo que aunque esa
 *   persona se borre despues. Eso es precisamente lo que se espera de un
 *   documento inmutable.
 *
 * Cualquier actor operativo puede generarlo; el caso debe pertenecer a su
 * organizacion y no estar borrado. El snapshot se arma desde los getters del
 * dominio (sin importar mappers de HTTP — eslint boundaries) y queda
 * congelado: el caso sigue cambiando, el informe no.
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

      // Una aprobacion por sancion: la fila cuelga de la sancion, no del caso.
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
        // Metadatos, nunca el fichero: un informe es un indice de la cadena de
        // custodia, no un archivo adjunto. El SHA-256 es lo que permite
        // comprobar despues que la prueba entregada es la que se recogio.
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
          // INV-015. Va en el informe congelado por la misma razon que el hash
          // y el sello: es procedencia de la prueba. Si dentro de dos anos
          // alguien pregunta que se comprobo sobre este fichero antes de
          // aceptarlo, la respuesta tiene que estar dentro del snapshot, no en
          // una coleccion viva que para entonces habra cambiado.
          scanStatus: item.scanStatus,
          uploadedBy: item.uploadedBy,
          createdAt: item.createdAt,
          deletedAt: item.deletedAt,
        })),
        // La otra mitad del control de cuatro ojos: quien pidio y quien firmo.
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
    // Quien es el cliente, congelado. Sin esto el informe identifica al sujeto
    // por un `customerId` que no dice nada a quien lo lee desde fuera, y que
    // ademas puede haber dejado de resolver a nada en el proveedor.
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
 * Nombres de todas las personas que aparecen en el expediente, resueltos al
 * CONGELAR.
 *
 * Se guardan dentro del informe y no se resuelven al imprimirlo por lo mismo
 * que se congela el resto: un informe de hace dos anos tiene que seguir
 * diciendo quien cerro el caso aunque esa persona ya no exista en el sistema.
 * Un id que no resuelve simplemente no entra en el mapa, y quien lo lee
 * mostrara el id crudo antes que un nombre inventado.
 *
 * Si el directorio de identidad falla, el informe se genera igual sin nombres:
 * perder el expediente entero por no poder poner un nombre seria peor.
 */
/** Todos los ids de persona que aparecen en el expediente, sin repetir. */
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
