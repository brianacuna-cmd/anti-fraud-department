import { oid } from '../../../support/oid.js';
import { createRequestCaseDocumentationUseCase } from '../../../../src/modules/case-management/application/RequestCaseDocumentation.js';
import { createResumeCaseReviewUseCase } from '../../../../src/modules/case-management/application/ResumeCaseReview.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-03-01T10:00:00.000Z'));
const DUE = fromDate(new Date('2026-03-02T10:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });
const AUDITOR = createAuthContext({ userId: oid('auditor-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'AUDITOR' });
const CASE_ID = oid('case-1');

function buildCase(organizationId = ORG_1): Case {
  return Case.create({
    id: createCaseId(CASE_ID),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    assignedTo: createAssignedTo('USER', oid('analyst-1')),
    now: NOW,
  }).withDueDate(DUE, NOW);
}

function build() {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const deps = {
    cases,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  };
  return {
    cases,
    timelineRecorder,
    auditRecorder,
    requestDocumentation: createRequestCaseDocumentationUseCase(deps),
    resumeReview: createResumeCaseReviewUseCase(deps),
  };
}

describe('createRequestCaseDocumentationUseCase', () => {
  it('parks an IN_REVIEW case in PENDING_DOCUMENTATION with both timeline milestones and the audit row', async () => {
    const { cases, timelineRecorder, auditRecorder, requestDocumentation } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    const pending = await requestDocumentation({
      auth: ANALYST,
      caseId: CASE_ID,
      requestedDocuments: '  Extracto bancario de marzo  ',
    });

    expect(pending.status).toBe('PENDING_DOCUMENTATION');
    const timeline = timelineRecorder.all();
    expect(timeline.map((e) => e.eventType)).toEqual(['STATE_CHANGED', 'DOCUMENTATION_REQUESTED']);
    expect(timeline[0]).toMatchObject({ previousValue: 'IN_REVIEW', newValue: 'PENDING_DOCUMENTATION' });
    expect(timeline[1]?.newValue).toBe('Extracto bancario de marzo');
    expect(auditRecorder.all()[0]).toMatchObject({
      action: 'REQUEST_CASE_DOCUMENTATION',
      detail: { previousStatus: 'IN_REVIEW', requestedDocuments: 'Extracto bancario de marzo' },
    });
  });

  it('keeps the SLA running: dueDate is not cleared or moved', async () => {
    const { cases, requestDocumentation } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    const pending = await requestDocumentation({ auth: ANALYST, caseId: CASE_ID, requestedDocuments: 'KYC' });

    expect(pending.dueDate).toBe(DUE);
  });

  it('rejects asking for documentation on an OPEN case (review comes first)', async () => {
    const { cases, requestDocumentation } = build();
    await cases.save(buildCase());

    await expect(
      requestDocumentation({ auth: ANALYST, caseId: CASE_ID, requestedDocuments: 'KYC' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('rejects a blank request before touching the case', async () => {
    const { cases, timelineRecorder, requestDocumentation } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    await expect(
      requestDocumentation({ auth: ANALYST, caseId: CASE_ID, requestedDocuments: '   ' }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
    expect((await cases.findById(createCaseId(CASE_ID)))?.status).toBe('IN_REVIEW');
    expect(timelineRecorder.all()).toHaveLength(0);
  });

  it('rejects the governance tier with FORBIDDEN_ROLE', async () => {
    const { cases, requestDocumentation } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    await expect(
      requestDocumentation({ auth: AUDITOR, caseId: CASE_ID, requestedDocuments: 'KYC' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('rejects a case from another organization', async () => {
    const { cases, requestDocumentation } = build();
    await cases.save(buildCase(ORG_2).transitionTo('IN_REVIEW', NOW));

    await expect(
      requestDocumentation({ auth: ANALYST, caseId: CASE_ID, requestedDocuments: 'KYC' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});

describe('createResumeCaseReviewUseCase', () => {
  it('brings a PENDING_DOCUMENTATION case back to IN_REVIEW, SLA untouched', async () => {
    const { cases, timelineRecorder, auditRecorder, resumeReview } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW).transitionTo('PENDING_DOCUMENTATION', NOW));

    const resumed = await resumeReview({ auth: ANALYST, caseId: CASE_ID });

    expect(resumed.status).toBe('IN_REVIEW');
    expect(resumed.dueDate).toBe(DUE);
    expect(timelineRecorder.all()[0]).toMatchObject({
      eventType: 'STATE_CHANGED',
      previousValue: 'PENDING_DOCUMENTATION',
      newValue: 'IN_REVIEW',
    });
    expect(auditRecorder.all()[0]?.action).toBe('RESUME_CASE_REVIEW');
  });

  it('is not a second door into review: an OPEN case is rejected', async () => {
    const { cases, resumeReview } = build();
    await cases.save(buildCase());

    await expect(resumeReview({ auth: ANALYST, caseId: CASE_ID })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});
