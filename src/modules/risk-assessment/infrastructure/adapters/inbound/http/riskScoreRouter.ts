import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCalculateRiskScoreUseCase } from '../../../../application/CalculateRiskScore.js';
import { calculateRiskScoreSchema } from './dto/riskScoreSchemas.js';
import { toCanonicalRiskEvent, toRiskScoreResponse } from './mappers/RiskScoreHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface RiskScoreRouterDeps {
  readonly calculateRiskScore: ReturnType<typeof createCalculateRiskScoreUseCase>;
}

/**
 * `/risk-scores` routes. Standalone scoring — does not create a Case.
 * Express 5 forwards a rejected handler promise to `errorHandler`
 * automatically (mirrors `caseRouter`).
 */
export function riskScoreRouter(deps: RiskScoreRouterDeps): Router {
  const router = Router();

  router.post('/risk-scores', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(calculateRiskScoreSchema, req.body);
    const result = await deps.calculateRiskScore({
      auth,
      event: toCanonicalRiskEvent(body),
    });
    res.status(200).json(toRiskScoreResponse(result));
  });

  return router;
}
