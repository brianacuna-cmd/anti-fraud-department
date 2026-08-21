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
const ORG_2 = oid('org-2');
const INV_ID = oid('inv-graph-1');
const ROOT_WALLET = '0xroot';

const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});
const OTHER_TENANT = createAuthContext({
  userId: oid('x'),
  organizationId: ORG_2,
  actorType: 'USER',
  roleId: 'ANALYST',
});

let seq = 0;
function seedCase(overrides: {
  organizationId?: string;
  customerId?: string;
  customerEmail?: string | null;
  bridgeWallet?: string | null;
}): Case {
  seq += 1;
  return Case.create({
    id: createCaseId(oid(`case-graph-${seq}`)),
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: overrides.customerId ?? `customer-${seq}`,
    customerEmail: overrides.customerEmail ?? null,
    bridgeWallet: overrides.bridgeWallet ?? null,
    riskScore: createRiskScore(70),
    priority: 'HIGH',
    now: NOW,
  });
}

function buildApp(actorPerRequest: () => AuthContext = () => ANALYST) {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);
  const timelineRecorder = new InMemoryTimelineRecorder();

  const deps = { investigations, auditRecorder, unitOfWork, clock };
  const router = investigationRouter({
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

  return { app, investigations, cases };
}

async function seedInvestigation(investigations: InMemoryInvestigationRepository, organizationId = ORG_1) {
  await investigations.save(
    Investigation.open({
      id: createInvestigationId(INV_ID),
      caseId: createCaseId(oid('case-graph-root')),
      organizationId,
      subjectType: 'WALLET',
      subjectId: ROOT_WALLET,
      openedBy: oid('analyst-1'),
      now: NOW,
    }),
  );
}

describe('investigationRouter GET /investigations/:id/graph (INV-013)', () => {
  it('devuelve la red con nodos, aristas y profundidad alcanzada', async () => {
    const { app, investigations, cases } = buildApp();
    await seedInvestigation(investigations);

    const first = seedCase({ customerId: 'cus-a', bridgeWallet: ROOT_WALLET, customerEmail: 'mula@x.com' });
    const second = seedCase({ customerId: 'cus-b', customerEmail: 'mula@x.com' });
    await cases.save(first);
    await cases.save(second);

    const response = await request(app).get(`/api/v1/investigations/${INV_ID}/graph`);

    expect(response.status).toBe(200);
    expect(response.body.rootId).toBe(`WALLET:${ROOT_WALLET}`);

    const ids = (response.body.nodes as { id: string }[]).map((node) => node.id);
    expect(ids).toContain(`CASE:${first.id}`);
    expect(ids).toContain('EMAIL:mula@x.com');
    // El segundo caso solo aparece por el email compartido: es el salto que
    // justifica que exista este endpoint.
    expect(ids).toContain(`CASE:${second.id}`);
    expect(response.body.edges.length).toBeGreaterThan(0);
    expect(response.body.truncated).toBe(false);
  });

  it('respeta maxDepth de la query y marca el recorte', async () => {
    const { app, investigations, cases } = buildApp();
    await seedInvestigation(investigations);
    await cases.save(seedCase({ customerId: 'cus-a', bridgeWallet: ROOT_WALLET }));

    const response = await request(app).get(`/api/v1/investigations/${INV_ID}/graph?maxDepth=1`);

    expect(response.status).toBe(200);
    expect(response.body.depthReached).toBe(1);
    expect(response.body.truncated).toBe(true);
  });

  it('rechaza una maxDepth fuera de rango en el borde', async () => {
    const { app, investigations } = buildApp();
    await seedInvestigation(investigations);

    const response = await request(app).get(`/api/v1/investigations/${INV_ID}/graph?maxDepth=99`);

    expect(response.status).toBe(400);
  });

  it('404 cuando la investigación no existe', async () => {
    const { app } = buildApp();

    const response = await request(app).get(`/api/v1/investigations/${oid('missing')}/graph`);

    expect(response.status).toBe(404);
  });

  it('403 cuando la investigación es de otro inquilino', async () => {
    const { app, investigations } = buildApp(() => OTHER_TENANT);
    await seedInvestigation(investigations, ORG_1);

    const response = await request(app).get(`/api/v1/investigations/${INV_ID}/graph`);

    expect(response.status).toBe(403);
  });

  it('no confunde "graph" con un id de investigación', async () => {
    const { app, investigations } = buildApp();
    await seedInvestigation(investigations);

    // Express casa por orden: si la ruta del grafo se registrara despues de
    // `/investigations/:investigationId`, esta peticion caeria en el detalle.
    const response = await request(app).get(`/api/v1/investigations/${INV_ID}/graph`);

    expect(response.body).toHaveProperty('nodes');
    expect(response.body).not.toHaveProperty('subjectType');
  });
});
