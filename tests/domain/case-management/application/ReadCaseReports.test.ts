import { oid } from '../../../support/oid.js';
import { createGenerateCaseReportUseCase } from '../../../../src/modules/case-management/application/GenerateCaseReport.js';
import { createListCaseReportsUseCase } from '../../../../src/modules/case-management/application/ListCaseReports.js';
import { createGetCaseReportUseCase } from '../../../../src/modules/case-management/application/GetCaseReport.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateCaseReportId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';
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

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });
const OTHER = createAuthContext({ userId: oid('x'), organizationId: oid('org-2'), actorType: 'USER', roleId: 'ANALYST' });

function build() {
  const cases = new InMemoryCaseRepository();
  const reports = new InMemoryCaseReportRepository();
  const generateCaseReport = createGenerateCaseReportUseCase({
    cases,
    timelineReader: new InMemoryTimelineRecorder(),
    notes: new InMemoryCaseNoteRepository(),
    investigations: new InMemoryInvestigationRepository(),
    resolutions: new InMemoryResolutionRepository(),
    enforcementActions: new InMemoryEnforcementActionRepository(),
    analystDecisions: new InMemoryAnalystDecisionRepository(),
    evidence: new InMemoryEvidenceRepository(),
    approvalRequests: new InMemoryApprovalRequestRepository(),
    slaTracking: new InMemoryCaseSlaTrackingRepository(),
    assignees: new InMemoryAssigneeDirectory(),
    reports,
    auditRecorder: new InMemoryCaseManagementAuditRecorder(),
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateCaseReportId,
  });
  return {
    cases,
    generateCaseReport,
    listCaseReports: createListCaseReportsUseCase({ cases, reports }),
    getCaseReport: createGetCaseReportUseCase({ reports }),
  };
}

async function seedCaseWithReport(h: ReturnType<typeof build>) {
  await h.cases.save(
    // The report requires the case closed. See `WorkflowStepGate.assertReadyForReport`.
    Case.create({
      id: createCaseId(oid('case-1')),
      organizationId: ORG_1,
      customerId: 'customer-1',
      riskScore: createRiskScore(50),
      priority: 'MEDIUM',
      now: NOW,
    })
      .transitionTo('IN_REVIEW', NOW)
      .transitionTo('RESOLVED', NOW),
  );
  return h.generateCaseReport({ auth: ANALYST, caseId: oid('case-1') });
}

describe('list + get case report', () => {
  it('lists a case reports and gets one by id (tenant-gated)', async () => {
    const h = build();
    const report = await seedCaseWithReport(h);

    const listed = await h.listCaseReports({ auth: ANALYST, caseId: oid('case-1') });
    expect(listed).toHaveLength(1);

    const fetched = await h.getCaseReport({ auth: ANALYST, reportId: report.id });
    expect(fetched.id).toBe(report.id);
  });

  it('getCaseReport throws CASE_REPORT_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(
      h.getCaseReport({ auth: ANALYST, reportId: oid('missing') }),
    ).rejects.toMatchObject({ code: 'CASE_REPORT_NOT_FOUND' });
  });

  it('getCaseReport throws forbiddenCrossTenant for another organization', async () => {
    const h = build();
    const report = await seedCaseWithReport(h);
    await expect(
      h.getCaseReport({ auth: OTHER, reportId: report.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
