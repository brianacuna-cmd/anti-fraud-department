import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { routingRuleRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/routingRuleRouter.js';
import { createCreateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/CreateRoutingRule.js';
import { createListRoutingRulesUseCase } from '../../../../src/modules/case-management/application/ListRoutingRules.js';
import { createGetRoutingRuleUseCase } from '../../../../src/modules/case-management/application/GetRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

const VALID_JDM = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function buildApp(actorPerRequest: () => AuthContext) {
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const clock = { now: () => NOW };
  const createRoutingRule = createCreateRoutingRuleUseCase({
    routingRules,
    auditRecorder,
    clock,
    generateCaseRoutingRuleId,
  });
  const listRoutingRules = createListRoutingRulesUseCase({ routingRules });
  const getRoutingRule = createGetRoutingRuleUseCase({ routingRules });

  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  api.use(
    routingRuleRouter({
      createRoutingRule,
      listRoutingRules,
      getRoutingRule,
    }),
  );

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({ ...caseManagementErrorStatus }),
    }),
    routingRules,
    auditRecorder,
  };
}

describe('routingRuleRouter (HTTP)', () => {
  it('creates an INACTIVE draft for SUPERVISOR', async () => {
    const { app, routingRules, auditRecorder } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    const response = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft-1', conditions: VALID_JDM, targetUserId: 'auto-user' })
      .expect(201);

    expect(response.body.status).toBe('INACTIVE');
    expect(response.body.name).toBe('draft-1');
    expect(response.body.targetUserId).toBe('auto-user');
    expect(routingRules.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('CREATE_ROUTING_RULE');
  });

  it('rejects invalid JDM without persisting', async () => {
    const { app, routingRules } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'ADMIN',
      }),
    );

    await request(app)
      .post('/api/v1/case-routing-rules')
      .send({
        name: 'bad',
        conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
      })
      .expect(400);

    expect(routingRules.all()).toHaveLength(0);
  });

  it('rejects ANALYST create with 403', async () => {
    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'ANALYST',
      }),
    );

    await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(403);
  });

  it('lists ACTIVE and INACTIVE drafts for AUDITOR', async () => {
    const org = oid('org-1');
    let roleId: string = 'SUPERVISOR';
    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: org,
        roleId,
      }),
    );

    await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    roleId = 'AUDITOR';
    const listed = await request(app).get('/api/v1/case-routing-rules').expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].status).toBe('INACTIVE');
    expect(listed.body.items[0].name).toBe('draft');
  });

  it('gets a draft by id for SUPERVISOR', async () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      roleId: 'SUPERVISOR',
    });
    const { app } = buildApp(() => auth);

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    const got = await request(app).get(`/api/v1/case-routing-rules/${created.body.id}`).expect(200);
    expect(got.body.id).toBe(created.body.id);
    expect(got.body.name).toBe('draft');
    expect(got.body.status).toBe('INACTIVE');
  });

  it('returns 404 for missing rule id', async () => {
    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'ADMIN',
      }),
    );

    await request(app).get(`/api/v1/case-routing-rules/${oid('missing-rule')}`).expect(404);
  });
});
