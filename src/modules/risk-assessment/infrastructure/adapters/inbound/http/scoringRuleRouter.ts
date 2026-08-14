import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateScoringRuleUseCase } from '../../../../application/CreateScoringRule.js';
import type { createActivateScoringRuleUseCase } from '../../../../application/ActivateScoringRule.js';
import type { createListScoringRulesUseCase } from '../../../../application/ListScoringRules.js';
import type { createGetScoringRuleUseCase } from '../../../../application/GetScoringRule.js';
import { createScoringRuleSchema } from './dto/scoringRuleSchemas.js';
import { toScoringRuleResponse } from './mappers/ScoringRuleHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface ScoringRuleRouterDeps {
  readonly createScoringRule: ReturnType<typeof createCreateScoringRuleUseCase>;
  readonly activateScoringRule: ReturnType<typeof createActivateScoringRuleUseCase>;
  readonly listScoringRules: ReturnType<typeof createListScoringRulesUseCase>;
  readonly getScoringRule: ReturnType<typeof createGetScoringRuleUseCase>;
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

  return router;
}
