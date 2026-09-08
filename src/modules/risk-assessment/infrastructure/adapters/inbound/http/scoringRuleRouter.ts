import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateScoringRuleUseCase } from '../../../../application/CreateScoringRule.js';
import type { createActivateScoringRuleUseCase } from '../../../../application/ActivateScoringRule.js';
import type { createListScoringRulesUseCase } from '../../../../application/ListScoringRules.js';
import type { createGetScoringRuleUseCase } from '../../../../application/GetScoringRule.js';
import {
  createFactorScoringRuleSchema,
  createScoringRuleSchema,
  simulateScoringRuleSchema,
} from './dto/scoringRuleSchemas.js';
import { buildFactorScoringJdm } from '../../../../domain/services/factorScoringJdm.js';
import type { createDeleteScoringRuleUseCase } from '../../../../application/DeleteScoringRule.js';
import { toCanonicalRiskEvent } from './mappers/RiskScoreHttpMapper.js';
import type { createSimulateScoringRuleUseCase } from '../../../../application/SimulateScoringRule.js';
import { toScoringRuleResponse } from './mappers/ScoringRuleHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface ScoringRuleRouterDeps {
  readonly createScoringRule: ReturnType<typeof createCreateScoringRuleUseCase>;
  readonly activateScoringRule: ReturnType<typeof createActivateScoringRuleUseCase>;
  readonly listScoringRules: ReturnType<typeof createListScoringRulesUseCase>;
  readonly getScoringRule: ReturnType<typeof createGetScoringRuleUseCase>;
  readonly deleteScoringRule: ReturnType<typeof createDeleteScoringRuleUseCase>;
  readonly simulateScoringRule: ReturnType<typeof createSimulateScoringRuleUseCase>;
}

/**
 * `/risk-scoring-rules` routes — draft create, activate, list, get.
 * Express 5 forwards rejected handler promises to `errorHandler`.
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

  /*
   * Guided builder: weighted factors instead of a hand-drawn graph. Reuses
   * `createScoringRule` — one way to create, one audit row — and all it adds
   * is translating the factors into a JDM graph. Born INACTIVE like any
   * draft: activating retires the rule in force, and that is asked for
   * separately and on purpose.
   */
  router.post('/risk-scoring-rules/factor-scoring', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createFactorScoringRuleSchema, req.body);
    const rule = await deps.createScoringRule({
      auth,
      name: body.name,
      conditions: buildFactorScoringJdm(body.factors),
      conditionsVersion: 1,
    });
    res.status(201).json(toScoringRuleResponse(rule));
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
   * Soft delete, so a `DELETE` that returns the rule rather than 204: the row
   * still exists and the panel wants to know its final state.
   */
  router.delete('/risk-scoring-rules/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const rule = await deps.deleteScoringRule({ auth, ruleId: req.params.id! });
    res.status(200).json(toScoringRuleResponse(rule));
  });

  return router;
}
