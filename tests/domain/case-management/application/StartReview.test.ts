import { oid } from '../../../support/oid.js';
import { createStartReviewUseCase } from '../../../../src/modules/case-management/application/StartReview.js';
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

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildCase(): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId: ORG_1,
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
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const startReview = createStartReviewUseCase({
    cases,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  });
  return { cases, timelineRecorder, auditRecorder, startReview };
}

describe('createStartReviewUseCase', () => {
  it('moves an OPEN case to IN_REVIEW (any authenticated actor) + STATE_CHANGED timeline + START_REVIEW audit', async () => {
    const { cases, timelineRecorder, auditRecorder, startReview } = build();
    await cases.save(buildCase());

    const reviewed = await startReview({ auth: ANALYST, caseId: oid('case-1') });

    expect(reviewed.status).toBe('IN_REVIEW');
    const timeline = timelineRecorder.all();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('STATE_CHANGED');
    expect(timeline[0]?.previousValue).toBe('OPEN');
    expect(timeline[0]?.newValue).toBe('IN_REVIEW');
    expect(auditRecorder.all()[0]?.action).toBe('START_REVIEW');
  });

  it('rejects starting review on an already IN_REVIEW case with INVALID_TRANSITION', async () => {
    const { cases, startReview } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    await expect(startReview({ auth: ANALYST, caseId: oid('case-1') })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});
