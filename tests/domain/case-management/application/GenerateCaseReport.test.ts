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
import { InMemoryCaseReportRepository } from '../../../helpers/case-management/InMemoryCaseReportRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

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
  return { cases, reports, auditRecorder, generateCaseReport, addCaseNote, openInvestigation };
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
