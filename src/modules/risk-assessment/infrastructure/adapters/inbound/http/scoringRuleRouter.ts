import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateScoringRuleUseCase } from '../../../../application/CreateScoringRule.js';
import type { createActivateScoringRuleUseCase } from '../../../../application/ActivateScoringRule.js';
import type { createListScoringRulesUseCase } from '../../../../application/ListScoringRules.js';
import type { createGetScoringRuleUseCase } from '../../../../application/GetScoringRule.js';
import {
  createScoringRuleSchema,
  simulateScoringRuleSchema,
} from './dto/scoringRuleSchemas.js';
import { toCanonicalRiskEvent } from './mappers/RiskScoreHttpMapper.js';
import type { createSimulateScoringRuleUseCase } from '../../../../application/SimulateScoringRule.js';
import { toScoringRuleResponse } from './mappers/ScoringRuleHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface ScoringRuleRouterDeps {
  readonly createScoringRule: ReturnType<typeof createCreateScoringRuleUseCase>;
  readonly activateScoringRule: ReturnType<typeof createActivateScoringRuleUseCase>;
  readonly listScoringRules: ReturnType<typeof createListScoringRulesUseCase>;
  readonly getScoringRule: ReturnType<typeof createGetScoringRuleUseCase>;
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
   * Ensayo en seco desde el editor de decisiones: evalúa el grafo que se está
   * dibujando contra un evento de ejemplo y no guarda nada. Se declara antes
   * que `/:id` por costumbre defensiva — hoy no colisionan, pero el día que
   * exista `POST /risk-scoring-rules/:id`, «simulate» dejaría de ser una ruta.
   *
   * Devuelve 200 aunque el grafo falle: que no compile es el resultado que se
   * ha venido a buscar, no un error del servidor.
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

  return router;
}
