import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateScoringRuleUseCase } from '../../../../application/CreateScoringRule.js';
import type { createCreateFactorScoringRuleUseCase } from '../../../../application/CreateFactorScoringRule.js';
import type { createActivateScoringRuleUseCase } from '../../../../application/ActivateScoringRule.js';
import type { createDeleteScoringRuleUseCase } from '../../../../application/DeleteScoringRule.js';
import type { createListScoringRulesUseCase } from '../../../../application/ListScoringRules.js';
import type { createGetScoringRuleUseCase } from '../../../../application/GetScoringRule.js';
import {
  createScoringRuleSchema,
  factorScoringRuleSchema,
  simulateScoringRuleSchema,
} from './dto/scoringRuleSchemas.js';
import { toCanonicalRiskEvent } from './mappers/RiskScoreHttpMapper.js';
import type { createSimulateScoringRuleUseCase } from '../../../../application/SimulateScoringRule.js';
import { toScoringRuleResponse } from './mappers/ScoringRuleHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface ScoringRuleRouterDeps {
  readonly createScoringRule: ReturnType<typeof createCreateScoringRuleUseCase>;
  readonly createFactorScoringRule: ReturnType<typeof createCreateFactorScoringRuleUseCase>;
  readonly activateScoringRule: ReturnType<typeof createActivateScoringRuleUseCase>;
  readonly deleteScoringRule: ReturnType<typeof createDeleteScoringRuleUseCase>;
  readonly listScoringRules: ReturnType<typeof createListScoringRulesUseCase>;
  readonly getScoringRule: ReturnType<typeof createGetScoringRuleUseCase>;
  readonly simulateScoringRule: ReturnType<typeof createSimulateScoringRuleUseCase>;
}

/**
 * `/risk-scoring-rules` routes — draft create (hand-authored or guided
 * factor builder), activate, delete, list, get. Express 5 forwards
 * rejected handler promises to `errorHandler`.
 */
export function scoringRuleRouter(deps: ScoringRuleRouterDeps): Router {
  const router = Router();

  router.post('/risk-scoring-rules', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createScoringRuleSchema, req.body);
    const rule = await deps.createScoringRule({
      auth,
      name: body.name,
      conditions: body.conditions,
      conditionsVersion: body.conditionsVersion,
    });
    res.status(201).json(toScoringRuleResponse(rule));
  });

  /*
   * The guided builder: a supervisor lists weighted factors instead of
   * hand-authoring a JDM graph. Declared before `/:id` for the same reason
   * as `/simulate` below — a static path never collides with a rule id.
   */
  router.post('/risk-scoring-rules/factor-scoring', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(factorScoringRuleSchema, req.body);
    const rule = await deps.createFactorScoringRule({
      auth,
      name: body.name,
      factors: body.factors,
    });
    res.status(201).json(toScoringRuleResponse(rule));
  });

  /*
   * Dry run from the decision editor: evaluates the graph being drawn against
   * a sample event and persists nothing. Declared before `/:id` out of
   * defensive habit — they do not collide today, but the day
   * `POST /risk-scoring-rules/:id` exists, "simulate" would stop being a route.
   *
   * Returns 200 even when the graph fails: that it does not compile is the
   * answer the caller came for, not a server error.
   */
  router.post('/risk-scoring-rules/simulate', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(simulateScoringRuleSchema, req.body);
    const outcome = await deps.simulateScoringRule({
      auth,
      conditions: body.conditions,
      event: toCanonicalRiskEvent(body.event),
    });
    res.status(200).json(outcome);
  });

  router.get('/risk-scoring-rules', async (req, res) => {
    const auth = requireAuthContext(req);
    const rules = await deps.listScoringRules({ auth });
    res.status(200).json({ items: rules.map(toScoringRuleResponse) });
  });

  router.get('/risk-scoring-rules/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const rule = await deps.getScoringRule({ auth, ruleId: req.params.id! });
    res.status(200).json(toScoringRuleResponse(rule));
  });

  router.post('/risk-scoring-rules/:id/activate', async (req, res) => {
    const auth = requireAuthContext(req);
    const rule = await deps.activateScoringRule({ auth, ruleId: req.params.id! });
    res.status(200).json(toScoringRuleResponse(rule));
  });

  /*
   * Logical delete, 200 with the rule (not 204): it still exists, it is
   * just hidden from the catalog. Rejects an ACTIVE rule (409) — mirrors
   * the frontend's own documented contract in `api/riskScoring.ts`.
   */
  router.delete('/risk-scoring-rules/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const rule = await deps.deleteScoringRule({ auth, ruleId: req.params.id! });
    res.status(200).json(toScoringRuleResponse(rule));
  });

  return router;
}
