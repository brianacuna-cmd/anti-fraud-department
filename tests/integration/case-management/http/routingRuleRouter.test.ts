import { oid } from '../../../support/oid.js';
import { tableOf } from '../../../support/jdm.js';
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
import { createActivateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/ActivateRoutingRule.js';
import { createDeactivateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/DeactivateRoutingRule.js';
import { createSimulateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/SimulateRoutingRule.js';
import { ZenRoutingEngine } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

/** Los nombres de los nodos en el orden en que el motor los recorrió. */
function traceOrder(trace: Record<string, { name: string; order: number }>): string[] {
  return Object.values(trace)
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.name);
}
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
  const listRoutingRules = createListRoutingRulesUseCase({ routingRules });
  const getRoutingRule = createGetRoutingRuleUseCase({ routingRules });
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
      listRoutingRules,
      getRoutingRule,
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
    expect(routingRules.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('CREATE_ROUTING_RULE');
  });

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

    it('evaluates a draft graph without persisting anything', async () => {
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
      expect(traceOrder(response.body.trace)).toEqual([
        'Caso',
        'Reparto',
        'Salida',
      ]);
      expect(routingRules.all()).toHaveLength(0);
      expect(auditRecorder.all()[0]?.action).toBe('SIMULATE_ROUTING_RULE');
    });

    /*
     * Ambos destinos nulos NO es un fallo: es lo que `RouteCase` lee como
     * «esta regla no asigna con este caso» antes de pasar a la siguiente.
     */
    it('separates "assigns nobody" from "the graph is broken"', async () => {
      const { app } = buildApp(SUPERVISOR);

      const response = await request(app)
        .post('/api/v1/case-routing-rules/simulate')
        .send({ conditions: ROUTING_GRAPH, case: { ...CASE, priority: 'LOW' } })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.targetUserId).toBeNull();
      expect(response.body.targetRoleId).toBeNull();
    });

    it('reports a broken graph as a result, not as a server error', async () => {
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

    it('rejects a case context the routing engine could not receive', async () => {
      const { app } = buildApp(SUPERVISOR);

      await request(app)
        .post('/api/v1/case-routing-rules/simulate')
        .send({ conditions: ROUTING_GRAPH, case: { ...CASE, priority: 'URGENT' } })
        .expect(400);
    });

    it('rejects ANALYST with 403', async () => {
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

  describe('POST /case-routing-rules/priority-mapping', () => {
    const SUPERVISOR = () =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      });

    const MAPPINGS = [
      { priority: 'CRITICAL', target: { type: 'ROLE', id: 'SUPERVISOR' } },
      { priority: 'LOW', target: { type: 'USER', id: 'user-9' } },
    ];

    it('builds the JDM server-side and stores an INACTIVE draft', async () => {
      const { app, routingRules, auditRecorder } = buildApp(SUPERVISOR);

      const response = await request(app)
        .post('/api/v1/case-routing-rules/priority-mapping')
        .send({ name: 'Reparto por prioridad', mappings: MAPPINGS })
        .expect(201);

      expect(response.body.status).toBe('INACTIVE');
      expect(auditRecorder.all()[0]?.action).toBe('CREATE_ROUTING_RULE');

      /*
       * Los destinos viven en las filas de la tabla, no en el destino de la
       * regla: una sola regla reparte a varias personas distintas, que es
       * justo lo que `targetUserId`/`targetRoleId` a nivel de regla no puede.
       */
      const stored = routingRules.all()[0]!;
      expect(stored.targetUserId).toBeNull();
      expect(stored.targetRoleId).toBeNull();
      expect(tableOf(stored.conditions).rules).toEqual([
        { _id: 'r1', i1: '"CRITICAL"', o1: 'null', o2: '"SUPERVISOR"' },
        { _id: 'r2', i1: '"LOW"', o1: '"user-9"', o2: 'null' },
      ]);
    });

    it('rejects an unknown priority without persisting', async () => {
      const { app, routingRules } = buildApp(SUPERVISOR);

      await request(app)
        .post('/api/v1/case-routing-rules/priority-mapping')
        .send({ name: 'Mala', mappings: [{ priority: 'URGENT', target: { type: 'ROLE', id: 'X' } }] })
        .expect(400);

      expect(routingRules.all()).toHaveLength(0);
    });

    it('rejects the same priority assigned twice without persisting', async () => {
      const { app, routingRules } = buildApp(SUPERVISOR);

      await request(app)
        .post('/api/v1/case-routing-rules/priority-mapping')
        .send({
          name: 'Repetida',
          mappings: [
            { priority: 'HIGH', target: { type: 'ROLE', id: 'ANALYST' } },
            { priority: 'HIGH', target: { type: 'USER', id: 'user-9' } },
          ],
        })
        .expect(400);

      expect(routingRules.all()).toHaveLength(0);
    });

    it('rejects an empty mapping', async () => {
      const { app } = buildApp(SUPERVISOR);

      await request(app)
        .post('/api/v1/case-routing-rules/priority-mapping')
        .send({ name: 'Vacía', mappings: [] })
        .expect(400);
    });

    it('rejects ANALYST with 403', async () => {
      const { app } = buildApp(() =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: oid('org-1'),
          roleId: 'ANALYST',
        }),
      );

      await request(app)
        .post('/api/v1/case-routing-rules/priority-mapping')
        .send({ name: 'Reparto', mappings: MAPPINGS })
        .expect(403);
    });
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
