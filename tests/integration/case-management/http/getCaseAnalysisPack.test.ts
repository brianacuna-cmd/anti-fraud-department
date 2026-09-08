import { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { oid } from '../../../support/oid.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, SYSTEM_AGENT_USER_ID, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { caseRouter, type CaseRouterDeps } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/caseRouter.js';
import { createGetCaseUseCase } from '../../../../src/modules/case-management/application/GetCase.js';
import { createGetCaseTimelineUseCase } from '../../../../src/modules/case-management/application/GetCaseTimeline.js';
import { createPutAgentBriefUseCase } from '../../../../src/modules/case-management/application/PutAgentBrief.js';
import { createListAmlAlertsUseCase } from '../../../../src/modules/screening/application/ListAmlAlerts.js';
import { createGetCaseAnalysisPack } from '../../../../src/composition/getCaseAnalysisPack.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const SUBJECT_ID = oid('case-subject');
const SNAPSHOT = { event: { caseCustomerId: 'cust-1' }, hits: [] };
function seedCase(id: string, organizationId = ORG_1, snapshot: Record<string, unknown> | null = SNAPSHOT): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId,
    customerId: 'cust-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    finturuCacheSnapshot: snapshot,
    now: NOW,
  });
}

function buildApp(actor: AuthContext = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' })) {
  const cases = new InMemoryCaseRepository();
  const notes = new InMemoryCaseNoteRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const getCase = createGetCaseUseCase({ cases });
  const getCaseTimeline = createGetCaseTimelineUseCase({ cases, timelineReader: timelineRecorder });
  const mounted = Router();
  mounted.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actor);
    next();
  });
  mounted.use(
    caseRouter({
      getCase,
      getCaseTimeline,
      getCaseAnalysisPack: createGetCaseAnalysisPack({
        getCase,
        getCaseTimeline,
        listAmlAlerts: createListAmlAlertsUseCase({ amlAlertRepository: new InMemoryAmlAlertRepository() }),
        cases,
      }),
      putAgentBrief: createPutAgentBriefUseCase({
        cases,
        timelineRecorder,
        auditRecorder: new InMemoryCaseManagementAuditRecorder(),
        unitOfWork: new PassthroughUnitOfWork(),
        clock: new FixedClock(NOW),
        generateTimelineEventId,
      }),
    } as unknown as CaseRouterDeps),
  );
  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: mounted }],
      errorHandler: createErrorHandler(caseManagementErrorStatus),
    }),
    cases,
    notes,
    timelineRecorder,
  };
}

describe('GET /api/v1/cases/:id/analysis-pack', () => {
  it('returns 200 with mapped composed facts', async () => {
    const { app, cases } = buildApp();
    await cases.save(seedCase(SUBJECT_ID));
    await cases.save(seedCase(oid('case-sib')));

    const response = await request(app).get(`/api/v1/cases/${SUBJECT_ID}/analysis-pack`);
    expect(response.status).toBe(200);
    expect(response.body.case.id).toBe(SUBJECT_ID);
    expect(response.body.snapshot).toEqual(SNAPSHOT);
    expect(response.body.snapshot).not.toHaveProperty('rawPayload');
    expect(response.body.relatedCases).toEqual([expect.objectContaining({ id: oid('case-sib') })]);
    expect(response.body.timeline).toEqual([]);
    expect(response.body.amlAlerts).toEqual([]);
    expect(response.body.agentBrief).toBeNull();
  });

  it('returns 404 CASE_NOT_FOUND for a missing case', async () => {
    const { app } = buildApp();
    const response = await request(app).get(`/api/v1/cases/${oid('missing')}/analysis-pack`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CASE_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN_CROSS_TENANT for a foreign org case', async () => {
    const { app, cases } = buildApp();
    await cases.save(seedCase(SUBJECT_ID, oid('org-2')));
    const response = await request(app).get(`/api/v1/cases/${SUBJECT_ID}/analysis-pack`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });
});

describe('PUT /api/v1/cases/:id/agent-brief', () => {
  const agent = createAuthContext({
    userId: SYSTEM_AGENT_USER_ID,
    organizationId: ORG_1,
    actorType: 'USER',
    roleId: 'ANALYST',
  });

  it('stores the brief on unassigned OPEN and returns it from the pack', async () => {
    const { app, cases, notes, timelineRecorder } = buildApp(agent);
    await cases.save(seedCase(SUBJECT_ID));
    const put = await request(app).put(`/api/v1/cases/${SUBJECT_ID}/agent-brief`).send({ brief: 'mule pattern' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ agentBrief: 'mule pattern', status: 'OPEN' });
    expect(timelineRecorder.all().map((event) => event.eventType)).toEqual(['AGENT_BRIEFING']);
    expect(await notes.listByCaseId(createCaseId(SUBJECT_ID))).toEqual([]);
    expect((await request(app).get(`/api/v1/cases/${SUBJECT_ID}/analysis-pack`)).body.agentBrief).toBe('mule pattern');
  });

  it.each([
    [createAuthContext({ userId: oid('org-owner'), organizationId: ORG_1, actorType: 'ORGANIZATION' }), 403, 'FORBIDDEN_ROLE'],
    [createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' }), 403, 'FORBIDDEN_ROLE'],
  ] as const)('rejects non-agent callers %#', async (actor, status, code) => {
    const { app, cases, timelineRecorder } = buildApp(actor);
    await cases.save(seedCase(SUBJECT_ID));
    const response = await request(app).put(`/api/v1/cases/${SUBJECT_ID}/agent-brief`).send({ brief: 'no' });
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect((await cases.findById(createCaseId(SUBJECT_ID)))?.agentBrief ?? null).toBeNull();
    expect(timelineRecorder.all()).toEqual([]);
  });

  it('returns 409 CASE_CLOSED for a resolved case', async () => {
    const { app, cases } = buildApp(agent);
    await cases.save(Case.rehydrate({ ...seedCase(SUBJECT_ID).toProps(), status: 'RESOLVED' }));
    const response = await request(app).put(`/api/v1/cases/${SUBJECT_ID}/agent-brief`).send({ brief: 'late' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CASE_CLOSED');
  });
});
