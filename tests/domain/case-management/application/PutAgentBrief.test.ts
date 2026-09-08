import { oid } from '../../../support/oid.js';
import { createPutAgentBriefUseCase } from '../../../../src/modules/case-management/application/PutAgentBrief.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext, SYSTEM_AGENT_USER_ID } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const CASE_ID = oid('case-1');
const AGENT = createAuthContext({
  userId: SYSTEM_AGENT_USER_ID,
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function openCase(organizationId = ORG_1): Case {
  return Case.create({
    id: createCaseId(CASE_ID),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
}

function build() {
  const cases = new InMemoryCaseRepository();
  const notes = new InMemoryCaseNoteRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  return {
    cases,
    notes,
    timelineRecorder,
    auditRecorder,
    putAgentBrief: createPutAgentBriefUseCase({
      cases,
      timelineRecorder,
      auditRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateTimelineEventId,
    }),
  };
}

describe('createPutAgentBriefUseCase', () => {
  it('stores a brief on unassigned OPEN with AGENT_BRIEFING and no CaseNote', async () => {
    const { cases, notes, timelineRecorder, auditRecorder, putAgentBrief } = build();
    await cases.save(openCase());
    const updated = await putAgentBrief({ auth: AGENT, caseId: CASE_ID, brief: 'mule activity' });
    expect(updated).toMatchObject({ agentBrief: 'mule activity', status: 'OPEN', assignedTo: null });
    expect(await notes.listByCaseId(createCaseId(CASE_ID))).toEqual([]);
    expect(timelineRecorder.all()).toEqual([
      expect.objectContaining({ eventType: 'AGENT_BRIEFING', previousValue: null, newValue: 'mule activity' }),
    ]);
    expect(auditRecorder.all()).toEqual([expect.objectContaining({ action: 'PUT_AGENT_BRIEF' })]);
  });

  it('replaces a prior brief last-write-wins', async () => {
    const { cases, timelineRecorder, putAgentBrief } = build();
    await cases.save(openCase());
    await putAgentBrief({ auth: AGENT, caseId: CASE_ID, brief: 'first' });
    const replaced = await putAgentBrief({ auth: AGENT, caseId: CASE_ID, brief: 'second' });
    expect(replaced).toMatchObject({ agentBrief: 'second', status: 'OPEN' });
    expect(timelineRecorder.all().map((event) => event.previousValue)).toEqual([null, 'first']);
  });

  it.each([
    [
      'ORGANIZATION',
      createAuthContext({ userId: oid('org-owner'), organizationId: ORG_1, actorType: 'ORGANIZATION' }),
      'FORBIDDEN_ROLE',
    ],
    [
      'human ANALYST',
      createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' }),
      'FORBIDDEN_ROLE',
    ],
  ] as const)('rejects %s', async (_label, auth, code) => {
    const { cases, notes, timelineRecorder, putAgentBrief } = build();
    await cases.save(openCase());
    await expect(putAgentBrief({ auth, caseId: CASE_ID, brief: 'no' })).rejects.toMatchObject({ code });
    expect((await cases.findById(createCaseId(CASE_ID)))?.agentBrief ?? null).toBeNull();
    expect(timelineRecorder.all()).toEqual([]);
    expect(await notes.listByCaseId(createCaseId(CASE_ID))).toEqual([]);
  });

  it('rejects closed, missing, and cross-tenant like other case writes', async () => {
    const { cases, putAgentBrief } = build();
    await cases.save(Case.rehydrate({ ...openCase().toProps(), status: 'RESOLVED' }));
    await expect(putAgentBrief({ auth: AGENT, caseId: CASE_ID, brief: 'late' })).rejects.toMatchObject({
      code: 'CASE_CLOSED',
    });
    const missing = build();
    await expect(missing.putAgentBrief({ auth: AGENT, caseId: oid('missing'), brief: 'x' })).rejects.toMatchObject({
      code: 'CASE_NOT_FOUND',
    });
    await missing.cases.save(openCase(oid('org-2')));
    await expect(missing.putAgentBrief({ auth: AGENT, caseId: CASE_ID, brief: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });
  });
});
