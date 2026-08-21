import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { investigationRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/investigationRouter.js';
import { createOpenInvestigationUseCase } from '../../../../src/modules/case-management/application/OpenInvestigation.js';
import { createListInvestigationsUseCase } from '../../../../src/modules/case-management/application/ListInvestigations.js';
import { createBuildEntityNetworkGraphUseCase } from '../../../../src/modules/case-management/application/BuildEntityNetworkGraph.js';
import { createExportInvestigationSummaryUseCase } from '../../../../src/modules/case-management/application/ExportInvestigationSummary.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { createGetInvestigationUseCase } from '../../../../src/modules/case-management/application/GetInvestigation.js';
import { createCloseInvestigationUseCase } from '../../../../src/modules/case-management/application/CloseInvestigation.js';
import { createUpdateInvestigationFindingsUseCase } from '../../../../src/modules/case-management/application/UpdateInvestigationFindings.js';
import { createLinkInvestigationCasesUseCase } from '../../../../src/modules/case-management/application/LinkInvestigationCases.js';
import { createListActiveInvestigationsUseCase } from '../../../../src/modules/case-management/application/ListActiveInvestigations.js';
import { createUpdateInvestigationStatusUseCase } from '../../../../src/modules/case-management/application/UpdateInvestigationStatus.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { Investigation } from '../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const CASE_ID = oid('case-inv-1');
const INV_ID = oid('inv-1');

const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });
const OTHER = createAuthContext({ userId: oid('x'), organizationId: oid('org-2'), actorType: 'USER', roleId: 'ANALYST' });

function seedInvestigation(): Investigation {
  return Investigation.open({
    id: createInvestigationId(INV_ID),
    caseId: createCaseId(CASE_ID),
    organizationId: ORG_1,
    subjectType: 'WALLET',
    subjectId: 'w-1',
    openedBy: oid('analyst-1'),
    now: NOW,
  });
}

function buildApp(actorPerRequest: () => AuthContext = () => ANALYST) {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);

  void cases.save(
    Case.create({
      id: createCaseId(CASE_ID),
      organizationId: ORG_1,
      customerId: 'customer-1',
      riskScore: createRiskScore(50),
      priority: 'MEDIUM',
      now: NOW,
    }),
  );

  const timelineRecorder = new InMemoryTimelineRecorder();
  const deps = { investigations, auditRecorder, unitOfWork, clock };
  const router = investigationRouter({
    exportInvestigationSummary: createExportInvestigationSummaryUseCase({
      cases,
      investigations,
      decisions: new InMemoryAnalystDecisionRepository(),
      enforcementActions: new InMemoryEnforcementActionRepository(),
      buildEntityNetworkGraph: createBuildEntityNetworkGraphUseCase({ cases, investigations }),
      clock,
    }),
    openInvestigation: createOpenInvestigationUseCase({ cases, ...deps, generateInvestigationId }),
    listInvestigations: createListInvestigationsUseCase({ cases, investigations }),
    getInvestigation: createGetInvestigationUseCase({ investigations }),
    buildEntityNetworkGraph: createBuildEntityNetworkGraphUseCase({ cases, investigations }),
    closeInvestigation: createCloseInvestigationUseCase(deps),
    updateInvestigationFindings: createUpdateInvestigationFindingsUseCase(deps),
    linkInvestigationCases: createLinkInvestigationCasesUseCase({
      investigations,
      cases,
      timelineRecorder,
      unitOfWork,
      clock,
      generateTimelineEventId,
    }),
    listActiveInvestigations: createListActiveInvestigationsUseCase({ investigations }),
    updateInvestigationStatus: createUpdateInvestigationStatusUseCase({
      investigations,
      auditRecorder,
      unitOfWork,
      clock,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actorPerRequest());
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(caseManagementErrorStatus),
  });

  return { app, investigations, cases, timelineRecorder };
}

describe('investigationRouter PATCH /investigations/:id/findings', () => {
  it('updates findings JSON + exploration depth', async () => {
    const { app, investigations } = buildApp();
    await investigations.save(seedInvestigation());

    const findings = { nodes: 12, ring: 'A' };
    const response = await request(app)
      .patch(`/api/v1/investigations/${INV_ID}/findings`)
      .send({ findings, explorationDepth: 4 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: INV_ID,
      findingsData: findings,
      explorationDepth: 4,
    });
    expect(investigations.all()[0]?.explorationDepth).toBe(4);
  });

  it('returns 400 when explorationDepth is negative', async () => {
    const { app, investigations } = buildApp();
    await investigations.save(seedInvestigation());

    const response = await request(app)
      .patch(`/api/v1/investigations/${INV_ID}/findings`)
      .send({ findings: { a: 1 }, explorationDepth: -2 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('returns 404 for a missing investigation', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .patch(`/api/v1/investigations/${oid('missing')}/findings`)
      .send({ findings: { a: 1 }, explorationDepth: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('INVESTIGATION_NOT_FOUND');
  });

  it('returns 403 for a cross-tenant actor', async () => {
    const { app, investigations } = buildApp(() => OTHER);
    await investigations.save(seedInvestigation());

    const response = await request(app)
      .patch(`/api/v1/investigations/${INV_ID}/findings`)
      .send({ findings: { a: 1 }, explorationDepth: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });
});

describe('investigationRouter POST /investigations/:id/link-cases', () => {
  function seedCase(cases: InMemoryCaseRepository, id: string): void {
    void cases.save(
      Case.create({
        id: createCaseId(id),
        organizationId: ORG_1,
        customerId: `customer-${id}`,
        riskScore: createRiskScore(50),
        priority: 'MEDIUM',
        now: NOW,
      }),
    );
  }

  it('links cases to an investigation and records timeline events', async () => {
    const { app, investigations, cases, timelineRecorder } = buildApp();
    await investigations.save(seedInvestigation());
    seedCase(cases, oid('case-x'));
    seedCase(cases, oid('case-y'));

    const response = await request(app)
      .post(`/api/v1/investigations/${INV_ID}/link-cases`)
      .send({ caseIds: [oid('case-x'), oid('case-y')] });

    expect(response.status).toBe(200);
    expect(response.body.linkedCaseIds).toEqual([oid('case-x'), oid('case-y')]);
    expect(timelineRecorder.all()).toHaveLength(2);
  });

  it('returns 404 when a linked case does not exist', async () => {
    const { app, investigations } = buildApp();
    await investigations.save(seedInvestigation());

    const response = await request(app)
      .post(`/api/v1/investigations/${INV_ID}/link-cases`)
      .send({ caseIds: [oid('nope')] });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CASE_NOT_FOUND');
  });

  it('returns 400 for an empty caseIds array', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post(`/api/v1/investigations/${INV_ID}/link-cases`)
      .send({ caseIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});

describe('investigationRouter GET /investigations + PATCH /investigations/:id/status', () => {
  it('lists active investigations for the org and reflects a status change', async () => {
    const { app, investigations } = buildApp();
    await investigations.save(seedInvestigation());

    const before = await request(app).get('/api/v1/investigations').expect(200);
    expect(before.body.items).toHaveLength(1);
    expect(before.body.items[0]).toMatchObject({ id: INV_ID, status: 'OPEN' });

    const patched = await request(app)
      .patch(`/api/v1/investigations/${INV_ID}/status`)
      .send({ status: 'INVESTIGATING' })
      .expect(200);
    expect(patched.body.status).toBe('INVESTIGATING');

    // still active after INVESTIGATING
    const afterInvestigating = await request(app).get('/api/v1/investigations').expect(200);
    expect(afterInvestigating.body.items).toHaveLength(1);

    // resolving removes it from the active list
    await request(app).patch(`/api/v1/investigations/${INV_ID}/status`).send({ status: 'RESOLVED' }).expect(200);
    const afterResolved = await request(app).get('/api/v1/investigations').expect(200);
    expect(afterResolved.body.items).toHaveLength(0);
  });

  it('returns 400 for an invalid target status', async () => {
    const { app, investigations } = buildApp();
    await investigations.save(seedInvestigation());

    const res = await request(app)
      .patch(`/api/v1/investigations/${INV_ID}/status`)
      .send({ status: 'CLOSED' })
      .expect(400);
    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('returns 422 for an illegal transition (RESOLVED -> INVESTIGATING)', async () => {
    const { app, investigations } = buildApp();
    await investigations.save(seedInvestigation());
    await request(app).patch(`/api/v1/investigations/${INV_ID}/status`).send({ status: 'RESOLVED' }).expect(200);

    const res = await request(app)
      .patch(`/api/v1/investigations/${INV_ID}/status`)
      .send({ status: 'INVESTIGATING' })
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('returns 404 for a missing investigation status update', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .patch(`/api/v1/investigations/${oid('missing')}/status`)
      .send({ status: 'RESOLVED' })
      .expect(404);
    expect(res.body.error.code).toBe('INVESTIGATION_NOT_FOUND');
  });
});
