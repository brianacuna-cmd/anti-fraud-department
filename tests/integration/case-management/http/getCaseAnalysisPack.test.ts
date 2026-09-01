import { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { oid } from '../../../support/oid.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { caseRouter, type CaseRouterDeps } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/caseRouter.js';
import { createGetCaseUseCase } from '../../../../src/modules/case-management/application/GetCase.js';
import { createGetCaseTimelineUseCase } from '../../../../src/modules/case-management/application/GetCaseTimeline.js';
import { createListAmlAlertsUseCase } from '../../../../src/modules/screening/application/ListAmlAlerts.js';
import { createGetCaseAnalysisPack } from '../../../../src/composition/getCaseAnalysisPack.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
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
  const timelineRecorder = new InMemoryTimelineRecorder();
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  const getCase = createGetCaseUseCase({ cases });
  const getCaseTimeline = createGetCaseTimelineUseCase({ cases, timelineReader: timelineRecorder });
  const getPack = createGetCaseAnalysisPack({
    getCase,
    getCaseTimeline,
    listAmlAlerts: createListAmlAlertsUseCase({ amlAlertRepository }),
    cases,
  });
  const mounted = Router();
  mounted.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actor);
    next();
  });
  mounted.use(
    caseRouter({
      getCase,
      getCaseTimeline,
      getCaseAnalysisPack: getPack,
    } as CaseRouterDeps),
  );
  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: mounted }],
      errorHandler: createErrorHandler(caseManagementErrorStatus),
    }),
    cases,
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
