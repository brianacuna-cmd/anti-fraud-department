import { oid } from '../../../support/oid.js';
import { createSimulateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/SimulateRoutingRule.js';
import { ZenRoutingEngine } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
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
import { createCreatePriorityAssignmentRuleUseCase } from '../../../../src/modules/case-management/application/CreatePriorityAssignmentRule.js';
import { createListRoutingRulesUseCase } from '../../../../src/modules/case-management/application/ListRoutingRules.js';
import { createGetRoutingRuleUseCase } from '../../../../src/modules/case-management/application/GetRoutingRule.js';
import { createActivateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/ActivateRoutingRule.js';
import { createDeactivateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/DeactivateRoutingRule.js';
import { createUpdateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/UpdateRoutingRule.js';
import { createReorderRoutingRulesUseCase } from '../../../../src/modules/case-management/application/ReorderRoutingRules.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));

const VALID_JDM = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function buildApp(actorPerRequest: () => AuthContext, clockNow: typeof NOW = NOW) {
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const clock = { now: () => clockNow };
  const unitOfWork = new PassthroughUnitOfWork();
  const createRoutingRule = createCreateRoutingRuleUseCase({
    routingRules,
    auditRecorder,
    unitOfWork,
    clock,
    generateCaseRoutingRuleId,
  });
  const createPriorityAssignmentRule = createCreatePriorityAssignmentRuleUseCase({ createRoutingRule });
  const listRoutingRules = createListRoutingRulesUseCase({ routingRules });
  const getRoutingRule = createGetRoutingRuleUseCase({ routingRules });
  const updateRoutingRule = createUpdateRoutingRuleUseCase({
    routingRules,
    auditRecorder,
    unitOfWork,
    clock,
  });
  const reorderRoutingRules = createReorderRoutingRulesUseCase({
    routingRules,
    auditRecorder,
    unitOfWork,
    clock,
  });
  const activateRoutingRule = createActivateRoutingRuleUseCase({
    routingRules,
    auditRecorder,
    unitOfWork,
    clock,
  });
  const deactivateRoutingRule = createDeactivateRoutingRuleUseCase({
    routingRules,
    auditRecorder,
    unitOfWork,
    clock,
  });

  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  api.use(
    routingRuleRouter({
      createRoutingRule,
      createPriorityAssignmentRule,
      listRoutingRules,
      getRoutingRule,
      updateRoutingRule,
      reorderRoutingRules,
      activateRoutingRule,
      deactivateRoutingRule,
      /* El motor de verdad: una prueba en seco con un doble no prueba nada. */
      simulateRoutingRule: createSimulateRoutingRuleUseCase({
        simulationEngine: new ZenRoutingEngine(),
        auditRecorder,
      }),
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
    expect(response.body.executionOrder).toBe(0);
    expect(routingRules.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('CREATE_ROUTING_RULE');
  });

  it('POST /case-routing-rules/priority-mapping builds the JDM and persists an INACTIVE draft with null rule-level targets', async () => {
    const { app, routingRules, auditRecorder } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    const response = await request(app)
      .post('/api/v1/case-routing-rules/priority-mapping')
      .send({
        name: 'priority-routing',
        mappings: [
          { priority: 'CRITICAL', target: { type: 'ROLE', id: 'SUPERVISOR' } },
          { priority: 'HIGH', target: { type: 'USER', id: oid('analyst-1') } },
        ],
      })
      .expect(201);

    expect(response.body.status).toBe('INACTIVE');
    expect(response.body.name).toBe('priority-routing');
    expect(response.body.targetRoleId).toBeNull();
    expect(response.body.targetUserId).toBeNull();
    expect(routingRules.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('CREATE_ROUTING_RULE');
  });

  it('rejects an empty mappings list on the priority-mapping endpoint', async () => {
    const { app, routingRules } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    await request(app)
      .post('/api/v1/case-routing-rules/priority-mapping')
      .send({ name: 'empty', mappings: [] })
      .expect(400);
    expect(routingRules.all()).toHaveLength(0);
  });

  it('rejects invalid JDM without persisting', async () => {
    const { app, routingRules } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
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
        roleId: 'SUPERVISOR',
      }),
    );

    await request(app).get(`/api/v1/case-routing-rules/${oid('missing-rule')}`).expect(404);
  });

  it('activates two drafts so both remain ACTIVE (non-exclusive)', async () => {
    const org = oid('org-1');
    const { app, routingRules, auditRecorder } = buildApp(
      () =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: org,
          roleId: 'SUPERVISOR',
        }),
      LATER,
    );

    const first = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft-a', conditions: VALID_JDM })
      .expect(201);
    const second = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft-b', conditions: VALID_JDM })
      .expect(201);

    const activatedA = await request(app)
      .post(`/api/v1/case-routing-rules/${first.body.id}/activate`)
      .expect(200);
    const activatedB = await request(app)
      .post(`/api/v1/case-routing-rules/${second.body.id}/activate`)
      .expect(200);

    expect(activatedA.body.status).toBe('ACTIVE');
    expect(activatedB.body.status).toBe('ACTIVE');
    expect(routingRules.all().filter((r) => r.status === 'ACTIVE')).toHaveLength(2);
    expect(auditRecorder.all().map((e) => e.action)).toEqual(
      expect.arrayContaining(['ACTIVATE_ROUTING_RULE', 'ACTIVATE_ROUTING_RULE']),
    );
  });

  it('deactivates one ACTIVE rule while sibling stays ACTIVE', async () => {
    const org = oid('org-1');
    const { app, routingRules } = buildApp(
      () =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: org,
          roleId: 'SUPERVISOR',
        }),
      LATER,
    );

    const first = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft-a', conditions: VALID_JDM })
      .expect(201);
    const second = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft-b', conditions: VALID_JDM })
      .expect(201);

    await request(app).post(`/api/v1/case-routing-rules/${first.body.id}/activate`).expect(200);
    await request(app).post(`/api/v1/case-routing-rules/${second.body.id}/activate`).expect(200);

    const deactivated = await request(app)
      .post(`/api/v1/case-routing-rules/${first.body.id}/deactivate`)
      .expect(200);

    expect(deactivated.body.status).toBe('INACTIVE');
    expect(routingRules.all().find((r) => r.id === first.body.id)?.status).toBe('INACTIVE');
    expect(routingRules.all().find((r) => r.id === second.body.id)?.status).toBe('ACTIVE');
  });

  it('rejects ANALYST activate with 403', async () => {
    const org = oid('org-1');
    let roleId: string = 'SUPERVISOR';
    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: org,
        roleId,
      }),
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    roleId = 'ANALYST';
    await request(app).post(`/api/v1/case-routing-rules/${created.body.id}/activate`).expect(403);
  });

  it('rejects AUDITOR deactivate with 403', async () => {
    const org = oid('org-1');
    let roleId: string = 'SUPERVISOR';
    const { app } = buildApp(
      () =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: org,
          roleId,
        }),
      LATER,
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);
    await request(app).post(`/api/v1/case-routing-rules/${created.body.id}/activate`).expect(200);

    roleId = 'AUDITOR';
    await request(app).post(`/api/v1/case-routing-rules/${created.body.id}/deactivate`).expect(403);
  });

  it('returns 404 for activate of missing rule', async () => {
    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    await request(app).post(`/api/v1/case-routing-rules/${oid('missing-rule')}/activate`).expect(404);
  });
});

describe('PATCH /case-routing-rules/:id', () => {
  it('lets SUPERVISOR patch an INACTIVE draft name and conditions', async () => {
    const { app, routingRules, auditRecorder } = buildApp(
      () =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: oid('org-1'),
          roleId: 'SUPERVISOR',
        }),
      LATER,
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    const patched = await request(app)
      .patch(`/api/v1/case-routing-rules/${created.body.id}`)
      .send({ name: 'renamed', conditions: { ...VALID_JDM, nodes: [{ id: 'n2', type: 'inputNode' }] } })
      .expect(200);

    expect(patched.body.name).toBe('renamed');
    expect(patched.body.status).toBe('INACTIVE');
    expect(patched.body.conditionsVersion).toBe(created.body.conditionsVersion + 1);
    expect(routingRules.all()[0]?.name).toBe('renamed');
    expect(auditRecorder.all().map((e) => e.action)).toContain('UPDATE_ROUTING_RULE');
  });

  it('lets SUPERVISOR patch an ACTIVE rule without changing status', async () => {
    const { app } = buildApp(
      () =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: oid('org-1'),
          roleId: 'SUPERVISOR',
        }),
      LATER,
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'live', conditions: VALID_JDM })
      .expect(201);
    await request(app).post(`/api/v1/case-routing-rules/${created.body.id}/activate`).expect(200);

    const patched = await request(app)
      .patch(`/api/v1/case-routing-rules/${created.body.id}`)
      .send({ name: 'live-renamed' })
      .expect(200);

    expect(patched.body.name).toBe('live-renamed');
    expect(patched.body.status).toBe('ACTIVE');
    expect(patched.body.conditionsVersion).toBe(created.body.conditionsVersion);
  });

  it('rejects ANALYST PATCH with 403 and leaves the rule unchanged', async () => {
    const org = oid('org-1');
    let roleId: string = 'SUPERVISOR';
    const { app, routingRules } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: org,
        roleId,
      }),
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    roleId = 'ANALYST';
    await request(app)
      .patch(`/api/v1/case-routing-rules/${created.body.id}`)
      .send({ name: 'hijacked' })
      .expect(403);

    expect(routingRules.all()[0]?.name).toBe('draft');
  });

  it('rejects invalid JDM without changing the stored rule', async () => {
    const { app, routingRules } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    await request(app)
      .patch(`/api/v1/case-routing-rules/${created.body.id}`)
      .send({
        conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
      })
      .expect(400);

    expect(routingRules.all()[0]?.name).toBe('draft');
    expect(routingRules.all()[0]?.conditionsVersion).toBe(created.body.conditionsVersion);
  });

  it('rejects status on PATCH with 400 and leaves status unchanged', async () => {
    const { app, routingRules } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    await request(app)
      .patch(`/api/v1/case-routing-rules/${created.body.id}`)
      .send({ status: 'ACTIVE' })
      .expect(400);

    expect(routingRules.all()[0]?.status).toBe('INACTIVE');
  });

  it('still serves list, get, activate, and deactivate after PATCH exists', async () => {
    const { app } = buildApp(
      () =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: oid('org-1'),
          roleId: 'SUPERVISOR',
        }),
      LATER,
    );

    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    await request(app).get('/api/v1/case-routing-rules').expect(200);
    await request(app).get(`/api/v1/case-routing-rules/${created.body.id}`).expect(200);
    await request(app).post(`/api/v1/case-routing-rules/${created.body.id}/activate`).expect(200);
    await request(app).post(`/api/v1/case-routing-rules/${created.body.id}/deactivate`).expect(200);
  });
});

/**
 * Ensayo en seco desde el editor de decisiones: evalúa el grafo que se está
 * dibujando sin guardar nada, con el MISMO motor que enruta en producción.
 */
describe('POST /case-routing-rules/simulate', () => {
  const SUPERVISOR = () =>
    createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      roleId: 'SUPERVISOR',
    });

  const CASE = { riskScore: 90, status: 'OPEN', priority: 'HIGH', tags: [] };

  /** Tabla mínima: prioridad ALTA -> la cola de supervisores. */
  const ROUTING_GRAPH = {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Caso', position: { x: 0, y: 0 } },
      {
        id: 'table',
        type: 'decisionTableNode',
        name: 'Reparto',
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'first',
          inputs: [{ id: 'i1', name: 'Prioridad', field: 'priority' }],
          outputs: [{ id: 'o1', name: 'Rol', field: 'targetRoleId' }],
          rules: [{ _id: 'r1', i1: '"HIGH"', o1: '"SUPERVISOR"' }],
        },
      },
      { id: 'output', type: 'outputNode', name: 'Salida', position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'table' },
      { id: 'e2', sourceId: 'table', targetId: 'output' },
    ],
  };

  it('evalúa un grafo en borrador sin persistir nada', async () => {
    const { app, routingRules, auditRecorder } = buildApp(SUPERVISOR);

    const response = await request(app)
      .post('/api/v1/case-routing-rules/simulate')
      .send({ conditions: ROUTING_GRAPH, case: CASE })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.targetRoleId).toBe('SUPERVISOR');
    expect(response.body.targetUserId).toBeNull();
    /*
     * La traza nodo a nodo es lo que el editor pinta sobre el grafo. Llega
     * indexada por id de nodo, no en orden: el recorrido lo da `order`.
     */
    expect(
      Object.values(response.body.trace as Record<string, { name: string; order: number }>)
        .sort((a, b) => a.order - b.order)
        .map((entry) => entry.name),
    ).toEqual(['Caso', 'Reparto', 'Salida']);
    expect(routingRules.all()).toHaveLength(0);
    expect(auditRecorder.all().map((e) => e.action)).toContain('SIMULATE_ROUTING_RULE');
  });

  /*
   * Ambos destinos nulos NO es un fallo: es lo que `RouteCase` lee como «esta
   * regla no asigna con este caso» antes de pasar a la siguiente.
   */
  it('distingue «no asigna a nadie» de «el grafo está roto»', async () => {
    const { app } = buildApp(SUPERVISOR);

    const response = await request(app)
      .post('/api/v1/case-routing-rules/simulate')
      .send({ conditions: ROUTING_GRAPH, case: { ...CASE, priority: 'LOW' } })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.targetUserId).toBeNull();
    expect(response.body.targetRoleId).toBeNull();
  });

  /*
   * Que el grafo no compile es el resultado que se ha venido a buscar: con un
   * 500 el editor solo podría decir «algo falló».
   */
  it('devuelve un grafo roto como resultado, no como error del servidor', async () => {
    const { app } = buildApp(SUPERVISOR);

    const response = await request(app)
      .post('/api/v1/case-routing-rules/simulate')
      .send({
        conditions: {
          ...ROUTING_GRAPH,
          nodes: [{ id: 'solo', type: 'decisionTableNode', content: { hitPolicy: 'first' } }],
          edges: [],
        },
        case: CASE,
      })
      .expect(200);

    expect(response.body.ok).toBe(false);
  });

  it('rechaza un contexto de caso que el motor no podría recibir', async () => {
    const { app } = buildApp(SUPERVISOR);

    await request(app)
      .post('/api/v1/case-routing-rules/simulate')
      .send({ conditions: ROUTING_GRAPH, case: { ...CASE, priority: 'URGENT' } })
      .expect(400);
  });

  it('rechaza a ANALYST con 403', async () => {
    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'ANALYST',
      }),
    );

    await request(app)
      .post('/api/v1/case-routing-rules/simulate')
      .send({ conditions: ROUTING_GRAPH, case: CASE })
      .expect(403);
  });
});

describe('PUT /case-routing-rules/reorder', () => {
  const supervisor = () =>
    createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      roleId: 'SUPERVISOR',
    });

  it('lets SUPERVISOR reorder the full catalog and GET exposes executionOrder', async () => {
    const { app, auditRecorder } = buildApp(supervisor, LATER);

    const a = await request(app).post('/api/v1/case-routing-rules').send({ name: 'A', conditions: VALID_JDM }).expect(201);
    const b = await request(app).post('/api/v1/case-routing-rules').send({ name: 'B', conditions: VALID_JDM }).expect(201);
    const c = await request(app).post('/api/v1/case-routing-rules').send({ name: 'C', conditions: VALID_JDM }).expect(201);
    expect(a.body.executionOrder).toBe(0);
    expect(b.body.executionOrder).toBe(1);
    expect(c.body.executionOrder).toBe(2);

    const ids = [c.body.id, a.body.id, b.body.id];
    const reordered = await request(app).put('/api/v1/case-routing-rules/reorder').send({ ids }).expect(200);

    expect(reordered.body.items.map((item: { id: string }) => item.id)).toEqual(ids);
    expect(reordered.body.items.map((item: { executionOrder: number }) => item.executionOrder)).toEqual([0, 1, 2]);
    expect(auditRecorder.all().map((event) => event.action)).toContain('REORDER_ROUTING_RULES');
    expect(auditRecorder.all().find((event) => event.action === 'REORDER_ROUTING_RULES')).toEqual(
      expect.objectContaining({ resourceId: null, detail: { ids } }),
    );

    const listed = await request(app).get('/api/v1/case-routing-rules').expect(200);
    expect(listed.body.items.map((item: { name: string }) => item.name)).toEqual(['C', 'A', 'B']);
    expect(listed.body.items.map((item: { executionOrder: number }) => item.executionOrder)).toEqual([0, 1, 2]);

    const got = await request(app).get(`/api/v1/case-routing-rules/${c.body.id}`).expect(200);
    expect(got.body.executionOrder).toBe(0);
  });

  it('does not treat /reorder as GET or PATCH :id', async () => {
    const { app } = buildApp(supervisor, LATER);
    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'only', conditions: VALID_JDM })
      .expect(201);

    await request(app).get('/api/v1/case-routing-rules/reorder').expect(400);
    await request(app).patch('/api/v1/case-routing-rules/reorder').send({ name: 'hijack' }).expect(400);

    const reordered = await request(app)
      .put('/api/v1/case-routing-rules/reorder')
      .send({ ids: [created.body.id] })
      .expect(200);
    expect(reordered.body.items).toHaveLength(1);
    expect(reordered.body.items[0].id).toBe(created.body.id);
  });

  it('rejects a partial list and ANALYST without changing order', async () => {
    let roleId = 'SUPERVISOR';
    const { app, routingRules } = buildApp(
      () =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: oid('org-1'),
          roleId,
        }),
      LATER,
    );

    const a = await request(app).post('/api/v1/case-routing-rules').send({ name: 'A', conditions: VALID_JDM }).expect(201);
    const b = await request(app).post('/api/v1/case-routing-rules').send({ name: 'B', conditions: VALID_JDM }).expect(201);

    await request(app).put('/api/v1/case-routing-rules/reorder').send({ ids: [b.body.id] }).expect(400);
    expect(routingRules.all().map((rule) => rule.executionOrder).sort()).toEqual([0, 1]);

    roleId = 'ANALYST';
    await request(app)
      .put('/api/v1/case-routing-rules/reorder')
      .send({ ids: [b.body.id, a.body.id] })
      .expect(403);
    expect(routingRules.all().find((rule) => rule.id === a.body.id)?.executionOrder).toBe(0);
  });

  it('still serves PATCH after reorder exists', async () => {
    const { app } = buildApp(supervisor, LATER);
    const created = await request(app)
      .post('/api/v1/case-routing-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    const patched = await request(app)
      .patch(`/api/v1/case-routing-rules/${created.body.id}`)
      .send({ name: 'still-patchable' })
      .expect(200);
    expect(patched.body.name).toBe('still-patchable');
    expect(patched.body.executionOrder).toBe(0);
  });
});
