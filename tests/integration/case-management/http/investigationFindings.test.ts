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
import { createGetInvestigationUseCase } from '../../../../src/modules/case-management/application/GetInvestigation.js';
import { createCloseInvestigationUseCase } from '../../../../src/modules/case-management/application/CloseInvestigation.js';
import { createUpdateInvestigationFindingsUseCase } from '../../../../src/modules/case-management/application/UpdateInvestigationFindings.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
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

  const deps = { investigations, auditRecorder, unitOfWork, clock };
  const router = investigationRouter({
    openInvestigation: createOpenInvestigationUseCase({ cases, ...deps, generateInvestigationId }),
    listInvestigations: createListInvestigationsUseCase({ cases, investigations }),
    getInvestigation: createGetInvestigationUseCase({ investigations }),
    closeInvestigation: createCloseInvestigationUseCase(deps),
    updateInvestigationFindings: createUpdateInvestigationFindingsUseCase(deps),
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

  return { app, investigations };
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
