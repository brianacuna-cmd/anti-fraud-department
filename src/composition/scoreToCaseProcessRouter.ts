import { Router } from 'express';
import { requireAuthContext } from '../shared/http/requestAuthContext.js';
import { calculateRiskScoreSchema } from '../modules/risk-assessment/infrastructure/adapters/inbound/http/dto/riskScoreSchemas.js';
import { toCanonicalRiskEvent } from '../modules/risk-assessment/infrastructure/adapters/inbound/http/mappers/RiskScoreHttpMapper.js';
import { parseRequest } from '../modules/risk-assessment/infrastructure/adapters/inbound/http/parseRequest.js';
import type { createScoreToCaseOrchestrator } from './scoreToCaseOrchestrator.js';
import type { ScoreToCaseOrchestratorResult } from './scoreToCaseOrchestrator.js';

export interface ScoreToCaseProcessRouterDeps {
  readonly processRiskScoreToCase: ReturnType<typeof createScoreToCaseOrchestrator>;
}

export interface ProcessRiskScoreResponseDto {
  readonly riskScore: number;
  readonly ruleId: string;
  readonly conditionsVersion: number;
  readonly opened: boolean;
  readonly caseId?: string;
  readonly priority?: string;
}

/**
 * Composition HTTP seam: `POST /risk-scores/process`.
 * Same event schema as standalone `/risk-scores`; opens a case when score ≥ low.
 */
export function scoreToCaseProcessRouter(deps: ScoreToCaseProcessRouterDeps): Router {
  const router = Router();

  router.post('/risk-scores/process', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(calculateRiskScoreSchema, req.body);
    const result = await deps.processRiskScoreToCase({
      auth,
      event: toCanonicalRiskEvent(body),
    });
    res.status(200).json(toProcessResponse(result));
  });

  return router;
}

function toProcessResponse(result: ScoreToCaseOrchestratorResult): ProcessRiskScoreResponseDto {
  return {
    riskScore: result.riskScore,
    ruleId: result.ruleId,
    conditionsVersion: result.conditionsVersion,
    opened: result.opened,
    ...(result.caseId !== undefined ? { caseId: result.caseId } : {}),
    ...(result.priority !== undefined ? { priority: result.priority } : {}),
  };
}
