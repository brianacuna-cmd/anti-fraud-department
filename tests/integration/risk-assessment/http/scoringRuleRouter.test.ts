import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { riskAssessmentErrorStatus } from '../../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/errorStatus.js';
import { scoringRuleRouter } from '../../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/scoringRuleRouter.js';
import { createCreateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/CreateScoringRule.js';
import { createCreateFactorScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/CreateFactorScoringRule.js';
import { createActivateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/ActivateScoringRule.js';
import { createDeleteScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/DeleteScoringRule.js';
import { createListScoringRulesUseCase } from '../../../../src/modules/risk-assessment/application/ListScoringRules.js';
import { createGetScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/GetScoringRule.js';
import { createSimulateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/SimulateScoringRule.js';
import { ZenRiskScoringEngine } from '../../../../src/modules/risk-assessment/infrastructure/adapters/outbound/zen/ZenRiskScoringEngine.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/risk-assessment/infrastructure/PassthroughUnitOfWork.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

/** Los nombres de los nodos en el orden en que el motor los recorrió. */
function traceOrder(trace: Record<string, { name: string; order: number }>): string[] {
  return Object.values(trace)
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.name);
}

const VALID_JDM = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function buildApp(actorPerRequest: () => AuthContext) {
  const scoringRules = new InMemoryRiskScoringRuleRepository();
  const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();
  const clock = { now: () => NOW };
  const createScoringRule = createCreateScoringRuleUseCase({
    scoringRules,
    auditRecorder,
    clock,
    generateRiskScoringRuleId,
  });
  const unitOfWork = new PassthroughUnitOfWork();
  const activateScoringRule = createActivateScoringRuleUseCase({
    scoringRules,
    unitOfWork,
    auditRecorder,
    clock,
  });
  const deleteScoringRule = createDeleteScoringRuleUseCase({
    scoringRules,
    unitOfWork,
    auditRecorder,
    clock,
  });
  const listScoringRules = createListScoringRulesUseCase({ scoringRules });
  const getScoringRule = createGetScoringRuleUseCase({ scoringRules });

  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  /* El motor de verdad: una prueba en seco que use un doble no prueba nada. */
  const scoringEngine = new ZenRiskScoringEngine();
  api.use(
    scoringRuleRouter({
      createScoringRule,
      createFactorScoringRule: createCreateFactorScoringRuleUseCase({ createScoringRule }),
      activateScoringRule,
      deleteScoringRule,
      listScoringRules,
      getScoringRule,
      simulateScoringRule: createSimulateScoringRuleUseCase({
        simulationEngine: scoringEngine,
        auditRecorder,
      }),
    }),
  );

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({ ...riskAssessmentErrorStatus }),
    }),
    scoringRules,
    auditRecorder,
  };
}

describe('scoringRuleRouter (HTTP)', () => {
  it('creates an INACTIVE draft for SUPERVISOR', async () => {
    const { app, scoringRules, auditRecorder } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    const response = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'draft-1', conditions: VALID_JDM })
      .expect(201);

    expect(response.body.status).toBe('INACTIVE');
    expect(response.body.name).toBe('draft-1');
    expect(scoringRules.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('CREATE_SCORING_RULE');
  });

  it('rejects invalid JDM without persisting', async () => {
    const { app, scoringRules } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      }),
    );

    await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'bad', conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] } })
      .expect(400);

    expect(scoringRules.all()).toHaveLength(0);
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
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(403);
  });

  describe('POST /risk-scoring-rules/simulate', () => {
    const SUPERVISOR = () =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        roleId: 'SUPERVISOR',
      });

    const EVENT = {
      provider: 'stripe',
      providerEventType: 'charge.succeeded',
      caseCustomerId: 'customer-1',
      amountCents: 900000,
      currency: 'usd',
      riskSignals: {},
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    /** Tabla mínima: importe alto -> 70. */
    const SCORING_GRAPH = {
      contentType: 'application/vnd.gorules.decision',
      nodes: [
        { id: 'input', type: 'inputNode', name: 'Evento', position: { x: 0, y: 0 } },
        {
          id: 'table',
          type: 'decisionTableNode',
          name: 'Puntuación',
          position: { x: 200, y: 0 },
          content: {
            hitPolicy: 'first',
            inputs: [{ id: 'i1', name: 'Importe', field: 'amountCents' }],
            outputs: [{ id: 'o1', name: 'Score', field: 'riskScore' }],
            rules: [{ _id: 'r1', i1: '> 500000', o1: '70' }],
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
      const { app, scoringRules, auditRecorder } = buildApp(SUPERVISOR);

      const response = await request(app)
        .post('/api/v1/risk-scoring-rules/simulate')
        .send({ conditions: SCORING_GRAPH, event: EVENT })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.riskScore).toBe(70);
      expect(response.body.warning).toBeNull();
      /*
       * La traza nodo a nodo es lo que el editor pinta sobre el grafo. Llega
       * indexada por id de nodo, no en orden: el recorrido lo da `order`.
       */
      expect(traceOrder(response.body.trace)).toEqual([
        'Evento',
        'Puntuación',
        'Salida',
      ]);
      expect(scoringRules.all()).toHaveLength(0);
      expect(auditRecorder.all()[0]?.action).toBe('SIMULATE_SCORING_RULE');
    });

    /*
     * Que el grafo no compile es el resultado que se ha venido a buscar: con
     * un 500 el editor solo podría decir «algo falló», que es exactamente lo
     * que ya sabía quien pulsó el botón.
     */
    it('reports a broken graph as a result, not as a server error', async () => {
      const { app } = buildApp(SUPERVISOR);

      const response = await request(app)
        .post('/api/v1/risk-scoring-rules/simulate')
        .send({
          conditions: {
            ...SCORING_GRAPH,
            nodes: [{ id: 'solo', type: 'decisionTableNode', content: { hitPolicy: 'first' } }],
            edges: [],
          },
          event: EVENT,
        })
        .expect(200);

      expect(response.body.ok).toBe(false);
      expect(typeof response.body.message).toBe('string');
    });

    /*
     * Un grafo que devuelve 140 tiene que fallar aquí y no en producción,
     * donde `CalculateRiskScore` falla cerrado y deja de abrirse ningún caso.
     */
    it('flags a score outside [0, 100] but still returns the trace', async () => {
      const { app } = buildApp(SUPERVISOR);

      const response = await request(app)
        .post('/api/v1/risk-scoring-rules/simulate')
        .send({
          conditions: {
            ...SCORING_GRAPH,
            nodes: SCORING_GRAPH.nodes.map((node) =>
              node.id === 'table'
                ? {
                    ...node,
                    content: {
                      ...(node as { content: Record<string, unknown> }).content,
                      rules: [{ _id: 'r1', i1: '> 500000', o1: '140' }],
                    },
                  }
                : node,
            ),
          },
          event: EVENT,
        })
        .expect(200);

      /*
       * El grafo compiló y corrió: lo que falla es lo que devuelve. Marcarlo
       * como `ok: false` escondería la traza justo cuando más falta hace.
       */
      expect(response.body.ok).toBe(true);
      expect(response.body.riskScore).toBeNull();
      expect(response.body.warning).toContain('between 0 and 100');
      expect(response.body.trace).toBeDefined();
    });

    it('is not swallowed by the /:id route', async () => {
      const { app } = buildApp(SUPERVISOR);

      await request(app)
        .post('/api/v1/risk-scoring-rules/simulate')
        .send({ conditions: SCORING_GRAPH, event: EVENT })
        .expect(200);
    });

    it('rejects an event the real scoring route would reject too', async () => {
      const { app } = buildApp(SUPERVISOR);

      await request(app)
        .post('/api/v1/risk-scoring-rules/simulate')
        .send({ conditions: SCORING_GRAPH, event: { ...EVENT, amount_cents: 1 } })
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
        .post('/api/v1/risk-scoring-rules/simulate')
        .send({ conditions: SCORING_GRAPH, event: EVENT })
        .expect(403);
    });
  });

  it('lists ACTIVE and INACTIVE drafts', async () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      roleId: 'SUPERVISOR',
    });
    const { app } = buildApp(() => auth);

    const created = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    await request(app).post(`/api/v1/risk-scoring-rules/${created.body.id}/activate`).expect(200);

    const listed = await request(app).get('/api/v1/risk-scoring-rules').expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].status).toBe('ACTIVE');

    await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'draft-2', conditions: VALID_JDM })
      .expect(201);

    const both = await request(app).get('/api/v1/risk-scoring-rules').expect(200);
    expect(both.body.items.map((item: { status: string }) => item.status).sort()).toEqual([
      'ACTIVE',
      'INACTIVE',
    ]);
  });

  it('activates a draft and deactivates the previous ACTIVE', async () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      roleId: 'SUPERVISOR',
    });
    const { app, auditRecorder } = buildApp(() => auth);

    const first = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'A', conditions: VALID_JDM })
      .expect(201);
    await request(app).post(`/api/v1/risk-scoring-rules/${first.body.id}/activate`).expect(200);

    const second = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'B', conditions: VALID_JDM })
      .expect(201);
    const activated = await request(app)
      .post(`/api/v1/risk-scoring-rules/${second.body.id}/activate`)
      .expect(200);

    expect(activated.body.status).toBe('ACTIVE');
    expect(activated.body.id).toBe(second.body.id);

    const listed = await request(app).get('/api/v1/risk-scoring-rules').expect(200);
    const byName = Object.fromEntries(
      listed.body.items.map((item: { name: string; status: string }) => [item.name, item.status]),
    );
    expect(byName).toEqual({ A: 'INACTIVE', B: 'ACTIVE' });
    expect(auditRecorder.all().some((e) => e.action === 'ACTIVATE_SCORING_RULE')).toBe(true);
  });
});

describe('DELETE /risk-scoring-rules/:id', () => {
  const SUPERVISOR = () =>
    createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), roleId: 'SUPERVISOR' });

  it('soft-deletes an INACTIVE draft and hides it from the list', async () => {
    const { app, scoringRules, auditRecorder } = buildApp(SUPERVISOR);

    const created = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    const deleted = await request(app)
      .delete(`/api/v1/risk-scoring-rules/${created.body.id}`)
      .expect(200);

    expect(deleted.body.id).toBe(created.body.id);
    expect(scoringRules.all()).toHaveLength(1);
    expect(scoringRules.all()[0]?.deletedAt).not.toBeNull();
    expect(auditRecorder.all().map((e) => e.action)).toContain('DELETE_SCORING_RULE');

    const listed = await request(app).get('/api/v1/risk-scoring-rules').expect(200);
    expect(listed.body.items).toHaveLength(0);
  });

  it('rejects deleting an ACTIVE rule with 409', async () => {
    const { app } = buildApp(SUPERVISOR);

    const created = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'live', conditions: VALID_JDM })
      .expect(201);
    await request(app).post(`/api/v1/risk-scoring-rules/${created.body.id}/activate`).expect(200);

    const res = await request(app)
      .delete(`/api/v1/risk-scoring-rules/${created.body.id}`)
      .expect(409);
    expect(res.body.error.code).toBe('SCORING_RULE_ACTIVE');
  });

  it('is idempotent on a second delete', async () => {
    const { app } = buildApp(SUPERVISOR);

    const created = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    await request(app).delete(`/api/v1/risk-scoring-rules/${created.body.id}`).expect(200);
    const again = await request(app)
      .delete(`/api/v1/risk-scoring-rules/${created.body.id}`)
      .expect(200);
    expect(again.body.id).toBe(created.body.id);
  });

  it('returns 404 for a missing rule id', async () => {
    const { app } = buildApp(SUPERVISOR);

    await request(app).delete(`/api/v1/risk-scoring-rules/${oid('missing-rule')}`).expect(404);
  });

  it('rejects ANALYST with 403', async () => {
    let roleId: string = 'SUPERVISOR';
    const { app } = buildApp(() =>
      createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), roleId }),
    );

    const created = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'draft', conditions: VALID_JDM })
      .expect(201);

    roleId = 'ANALYST';
    await request(app).delete(`/api/v1/risk-scoring-rules/${created.body.id}`).expect(403);
  });
});

describe('POST /risk-scoring-rules/factor-scoring', () => {
  const SUPERVISOR = () =>
    createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), roleId: 'SUPERVISOR' });

  it('builds an INACTIVE rule from weighted factors and scores it correctly end-to-end', async () => {
    const { app, scoringRules, auditRecorder } = buildApp(SUPERVISOR);

    const created = await request(app)
      .post('/api/v1/risk-scoring-rules/factor-scoring')
      .send({
        name: 'factor-rule',
        factors: [
          { field: 'amountCents', operator: 'GT', value: 500000, points: 40, reason: 'High amount' },
          { field: 'provider', operator: 'IN', value: ['stripe', 'bridge'], points: 10, reason: 'Known provider' },
        ],
      })
      .expect(201);

    expect(created.body.status).toBe('INACTIVE');
    expect(created.body.name).toBe('factor-rule');
    expect(scoringRules.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('CREATE_SCORING_RULE');

    // The generated graph must score exactly like a hand-authored one would.
    const simulated = await request(app)
      .post('/api/v1/risk-scoring-rules/simulate')
      .send({
        conditions: created.body.conditions,
        event: {
          provider: 'stripe',
          providerEventType: 'charge.succeeded',
          caseCustomerId: 'customer-1',
          amountCents: 900000,
          currency: 'usd',
          riskSignals: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })
      .expect(200);

    expect(simulated.body.ok).toBe(true);
    expect(simulated.body.riskScore).toBe(50);
  });

  it('rejects an empty factors list', async () => {
    const { app, scoringRules } = buildApp(SUPERVISOR);

    await request(app)
      .post('/api/v1/risk-scoring-rules/factor-scoring')
      .send({ name: 'empty', factors: [] })
      .expect(400);
    expect(scoringRules.all()).toHaveLength(0);
  });

  it('is not swallowed by the /:id route', async () => {
    const { app } = buildApp(SUPERVISOR);

    await request(app)
      .post('/api/v1/risk-scoring-rules/factor-scoring')
      .send({ name: 'x', factors: [{ field: 'amountCents', operator: 'GT', value: 1, points: 1, reason: 'x' }] })
      .expect(201);
  });

  it('rejects ANALYST with 403', async () => {
    const { app } = buildApp(() =>
      createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), roleId: 'ANALYST' }),
    );

    await request(app)
      .post('/api/v1/risk-scoring-rules/factor-scoring')
      .send({ name: 'x', factors: [{ field: 'amountCents', operator: 'GT', value: 1, points: 1, reason: 'x' }] })
      .expect(403);
  });
});

/**
 * The tenant owner login (`ORGANIZATION`), same standing as SUPERVISOR for
 * scoring configuration — `requireRuleAuthoringRole`, distinct from the
 * `requireOperationalRole`/`SCORING_RULE_WRITE_ROLES` pair every other
 * scoring-rule write used before it.
 */
describe('ORGANIZATION actor can author scoring rules', () => {
  const org = oid('org-1');
  const ORGANIZATION = () =>
    createAuthContext({ userId: org, organizationId: org, actorType: 'ORGANIZATION' });

  it('creates, activates, simulates, and deletes a rule', async () => {
    const { app, scoringRules } = buildApp(ORGANIZATION);

    const created = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'org-owned', conditions: VALID_JDM })
      .expect(201);
    expect(created.body.status).toBe('INACTIVE');

    await request(app).post(`/api/v1/risk-scoring-rules/${created.body.id}/activate`).expect(200);
    await request(app)
      .post('/api/v1/risk-scoring-rules/simulate')
      .send({
        conditions: created.body.conditions,
        event: {
          provider: 'stripe',
          providerEventType: 'charge.succeeded',
          caseCustomerId: 'customer-1',
          amountCents: 900000,
          currency: 'usd',
          riskSignals: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })
      .expect(200);

    // Deactivate first (delete rejects ACTIVE): activate a fresh draft to relieve it.
    const other = await request(app)
      .post('/api/v1/risk-scoring-rules')
      .send({ name: 'relief', conditions: VALID_JDM })
      .expect(201);
    await request(app).post(`/api/v1/risk-scoring-rules/${other.body.id}/activate`).expect(200);

    await request(app).delete(`/api/v1/risk-scoring-rules/${created.body.id}`).expect(200);
    expect(scoringRules.all().find((r) => r.id === created.body.id)?.deletedAt).not.toBeNull();
  });

  it('creates a factor-scoring rule', async () => {
    const { app } = buildApp(ORGANIZATION);

    await request(app)
      .post('/api/v1/risk-scoring-rules/factor-scoring')
      .send({ name: 'org-factors', factors: [{ field: 'amountCents', operator: 'GT', value: 1, points: 1, reason: 'x' }] })
      .expect(201);
  });
});
