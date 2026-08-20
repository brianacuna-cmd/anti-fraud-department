import { oid } from '../../../support/oid.js';
import { createGetCaseTimelineUseCase } from '../../../../src/modules/case-management/application/GetCaseTimeline.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

function buildCase(): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId: ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
}

function event(eventType: 'CASE_CREATED' | 'ASSIGNED', createdAt: typeof NOW): CaseTimelineEvent {
  return CaseTimelineEvent.create({
    id: generateTimelineEventId(),
    caseId: createCaseId(oid('case-1')),
    eventType,
    previousValue: null,
    newValue: null,
    createdBy: oid('analyst-1'),
    createdAt,
  });
}

describe('createGetCaseTimelineUseCase', () => {
  it('returns the case timeline oldest-first for the owning tenant', async () => {
    const cases = new InMemoryCaseRepository();
    await cases.save(buildCase());
    const timeline = new InMemoryTimelineRecorder();
    await timeline.record(event('ASSIGNED', LATER));
    await timeline.record(event('CASE_CREATED', NOW));

    const getCaseTimeline = createGetCaseTimelineUseCase({ cases, timelineReader: timeline });
    const events = await getCaseTimeline({ auth: ANALYST, caseId: oid('case-1') });

    expect(events.map((e) => e.eventType)).toEqual(['CASE_CREATED', 'ASSIGNED']);
  });

  it('throws caseNotFound when the case is missing', async () => {
    const getCaseTimeline = createGetCaseTimelineUseCase({
      cases: new InMemoryCaseRepository(),
      timelineReader: new InMemoryTimelineRecorder(),
    });

    await expect(
      getCaseTimeline({ auth: ANALYST, caseId: oid('missing') }),
    ).rejects.toBeInstanceOf(CaseManagementError);
  });
});
