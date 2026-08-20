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
import { createActivateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/ActivateScoringRule.js';
import { createListScoringRulesUseCase } from '../../../../src/modules/risk-assessment/application/ListScoringRules.js';
import { createGetScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/GetScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/risk-assessment/infrastructure/PassthroughUnitOfWork.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

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
  const activateScoringRule = createActivateScoringRuleUseCase({
    scoringRules,
    unitOfWork: new PassthroughUnitOfWork(),
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
  api.use(
    scoringRuleRouter({
      createScoringRule,
      activateScoringRule,
      listScoringRules,
      getScoringRule,
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
        roleId: 'ADMIN',
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
      roleId: 'ADMIN',
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
