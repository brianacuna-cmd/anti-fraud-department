import { oid } from '../../../support/oid.js';
import { createGenerateCaseReportUseCase } from '../../../../src/modules/case-management/application/GenerateCaseReport.js';
import { createAddCaseNoteUseCase } from '../../../../src/modules/case-management/application/AddCaseNote.js';
import { createOpenInvestigationUseCase } from '../../../../src/modules/case-management/application/OpenInvestigation.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateCaseReportId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';
import { generateCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryResolutionRepository } from '../../../helpers/case-management/InMemoryResolutionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryApprovalRequestRepository } from '../../../helpers/case-management/InMemoryApprovalRequestRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { InMemoryCaseReportRepository } from '../../../helpers/case-management/InMemoryCaseReportRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { Evidence } from '../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { createEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createApprovalRequestId } from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildCase(organizationId = ORG_1): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    // La regla de asignacion congela los expedientes huerfanos:
    // sin responsable no se pueden trabajar.
    assignedTo: createAssignedTo('USER', oid('analyst-1')),
    now: NOW,
  });
}

function build() {
  const cases = new InMemoryCaseRepository();
  const timeline = new InMemoryTimelineRecorder();
  const notes = new InMemoryCaseNoteRepository();
  const investigations = new InMemoryInvestigationRepository();
  const resolutions = new InMemoryResolutionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const analystDecisions = new InMemoryAnalystDecisionRepository();
  const evidence = new InMemoryEvidenceRepository();
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const assignees = new InMemoryAssigneeDirectory();
  const reports = new InMemoryCaseReportRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);

  const generateCaseReport = createGenerateCaseReportUseCase({
    cases,
    timelineReader: timeline,
    notes,
    investigations,
    resolutions,
    enforcementActions,
    analystDecisions,
    evidence,
    approvalRequests,
    slaTracking,
    assignees,
    reports,
    auditRecorder,
    unitOfWork,
    clock,
    generateCaseReportId,
  });
  const addCaseNote = createAddCaseNoteUseCase({
    cases,
    notes,
    timelineRecorder: timeline,
    auditRecorder,
    unitOfWork,
    clock,
    generateCaseNoteId,
    generateTimelineEventId,
  });
  const openInvestigation = createOpenInvestigationUseCase({
    cases,
    investigations,
    auditRecorder,
    unitOfWork,
    clock,
    generateInvestigationId,
  });
  return {
    cases,
    reports,
    auditRecorder,
    evidence,
    approvalRequests,
    slaTracking,
    assignees,
    enforcementActions,
    generateCaseReport,
    addCaseNote,
    openInvestigation,
  };
}

describe('createGenerateCaseReportUseCase', () => {
  it('persists an immutable snapshot with every section + GENERATE_CASE_REPORT audit', async () => {
    const h = build();
    await h.cases.save(buildCase());
    await h.addCaseNote({ auth: ANALYST, caseId: oid('case-1'), body: 'suspicious' });
    await h.openInvestigation({ auth: ANALYST, caseId: oid('case-1'), subjectType: 'WALLET', subjectId: 'w-1' });

    const report = await h.generateCaseReport({ auth: ANALYST, caseId: oid('case-1') });

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(Object.keys(snapshot)).toEqual(
      expect.arrayContaining([
        'case',
        'timeline',
        'notes',
        'investigations',
        'resolutions',
        'enforcementActions',
        'analystDecisions',
      ]),
    );
    expect((snapshot.notes as unknown[]).length).toBe(1);
    expect((snapshot.investigations as unknown[]).length).toBe(1);
    expect((snapshot.timeline as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((await h.reports.listByCaseId(createCaseId(oid('case-1')))).length).toBe(1);
    expect(h.auditRecorder.all().some((a) => a.action === 'GENERATE_CASE_REPORT')).toBe(true);
  });

  it('throws caseNotFound when the case does not exist', async () => {
    const h = build();
    await expect(
      h.generateCaseReport({ auth: ANALYST, caseId: oid('missing') }),
    ).rejects.toBeInstanceOf(CaseManagementError);
  });

  it('throws forbiddenCrossTenant for a case in another organization', async () => {
    const h = build();
    await h.cases.save(buildCase(ORG_2));
    await expect(
      h.generateCaseReport({ auth: ANALYST, caseId: oid('case-1') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});

/* -------------------------------------------------------------------------- */
/* El expediente congelado, completo                                           */
/* -------------------------------------------------------------------------- */

describe('createGenerateCaseReportUseCase — full case file', () => {
  const ANALYST_ID = oid('analyst-1');
  const SUPERVISOR_ID = oid('supervisor-1');
  const CASE_ID = createCaseId(oid('case-1'));
  const ACTION_ID = createEnforcementActionId(oid('action-1'));

  async function seedFullCase() {
    const built = build();
    const kase = buildCase();
    await built.cases.save(kase);

    await built.evidence.save(
      Evidence.register({
        id: createEvidenceId(oid('ev-1')),
        caseId: CASE_ID,
        investigationId: null,
        organizationId: ORG_1,
        filename: 'extracto.pdf',
        contentType: 'application/pdf',
        byteSize: 2048,
        sha256: 'a'.repeat(64),
        storageKey: 'k/1',
        timestamp: { token: 'tok', authority: 'FreeTSA', timestampedAt: NOW },
        scanStatus: 'CLEAN',
        uploadedBy: ANALYST_ID,
        now: NOW,
      }),
    );

    const action = EnforcementAction.create({
      id: ACTION_ID,
      caseId: CASE_ID,
      organizationId: ORG_1,
      analystDecisionId: createAnalystDecisionId(oid('dec-1')),
      actionType: 'BLOCK',
      targetType: 'WALLET',
      targetId: '0xabc',
      createdBy: ANALYST_ID,
      now: NOW,
    });
    await built.enforcementActions.save(action);
    await built.approvalRequests.save(
      ApprovalRequest.create({
        id: createApprovalRequestId(oid('approval-1')),
        enforcementActionId: ACTION_ID,
        requesterId: ANALYST_ID,
        now: NOW,
      }).approve({ reviewerId: SUPERVISOR_ID, reviewerComment: 'autorizado', now: NOW }),
    );

    await built.slaTracking.save(
      CaseSlaTracking.create({
        id: createCaseSlaTrackingId(oid('sla-1')),
        caseId: CASE_ID,
        dueDate: NOW,
        now: NOW,
      }),
    );

    built.assignees.nameFor(ORG_1, createAssignedTo('USER', ANALYST_ID), 'Ada Lovelace');
    built.assignees.nameFor(ORG_1, createAssignedTo('USER', SUPERVISOR_ID), 'Grace Hopper');

    return built;
  }

  /**
   * Sin la evidencia, el informe no acredita nada: el SHA-256 es lo que
   * permite a un tercero comprobar que el fichero que recibe es el que se
   * recogio.
   */
  it('freezes the evidence with its hash and its timestamp seal', async () => {
    const built = await seedFullCase();

    const report = await built.generateCaseReport({ auth: ANALYST, caseId: CASE_ID });

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(snapshot.evidence).toEqual([
      expect.objectContaining({
        filename: 'extracto.pdf',
        sha256: 'a'.repeat(64),
        byteSize: 2048,
        timestamp: { authority: 'FreeTSA', timestampedAt: NOW },
        scanStatus: 'CLEAN',
        uploadedBy: ANALYST_ID,
      }),
    ]);
  });

  /** Sin esto no consta quien autorizo la sancion: media auditoria de 4 ojos. */
  it('freezes who requested each sanction and who signed it off', async () => {
    const built = await seedFullCase();

    const report = await built.generateCaseReport({ auth: ANALYST, caseId: CASE_ID });

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(snapshot.approvals).toEqual([
      expect.objectContaining({
        enforcementActionId: ACTION_ID,
        actionType: 'BLOCK',
        status: 'APPROVED',
        requesterId: ANALYST_ID,
        reviewerId: SUPERVISOR_ID,
        reviewerComment: 'autorizado',
      }),
    ]);
  });

  /**
   * Los nombres se resuelven AL CONGELAR. Es lo que hace que el informe siga
   * diciendo quien hizo que dentro de dos anos, aunque esa persona ya no
   * exista en el sistema.
   */
  it('freezes the names of everyone who appears in the file', async () => {
    const built = await seedFullCase();

    const report = await built.generateCaseReport({ auth: ANALYST, caseId: CASE_ID });

    expect((report.snapshot as Record<string, unknown>).actors).toEqual({
      [ANALYST_ID]: 'Ada Lovelace',
      [SUPERVISOR_ID]: 'Grace Hopper',
    });
  });

  it('freezes the customer identity and the SLA, not just the customer id', async () => {
    const built = await seedFullCase();

    const report = await built.generateCaseReport({ auth: ANALYST, caseId: CASE_ID });

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(snapshot.case).toMatchObject({
      customer: expect.objectContaining({ email: null, bridgeUserId: null }),
    });
    expect(snapshot.sla).toEqual({ dueDate: NOW, status: 'ON_TRACK', updatedAt: NOW });
  });

  /** Perder el expediente por no poder poner un nombre seria peor. */
  it('still freezes the file when the identity directory is down', async () => {
    const built = await seedFullCase();
    jest.spyOn(built.assignees, 'displayNames').mockRejectedValue(new Error('identity is down'));

    const report = await built.generateCaseReport({ auth: ANALYST, caseId: CASE_ID });

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(snapshot.actors).toEqual({});
    expect(snapshot.evidence).toHaveLength(1);
  });

  it('leaves the new sections empty, never absent, on a bare case', async () => {
    const built = build();
    await built.cases.save(buildCase());

    const report = await built.generateCaseReport({ auth: ANALYST, caseId: CASE_ID });

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.approvals).toEqual([]);
    expect(snapshot.sla).toBeNull();
  });
});
