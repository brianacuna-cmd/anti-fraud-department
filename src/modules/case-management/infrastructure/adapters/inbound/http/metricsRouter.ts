import { Router } from 'express';
import { z } from 'zod';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGetFraudMetricsUseCase } from '../../../../application/GetFraudMetrics.js';
import { parseRequest } from './parseRequest.js';

export interface MetricsRouterDeps {
  readonly getFraudMetrics: ReturnType<typeof createGetFraudMetricsUseCase>;
}

/**
 * `windowDays` arrives as a string on the query string. `coerce` converts it
 * before validating; the real range (1..365) is checked by the use case,
 * which is where the reason for the cap lives.
 */
const overviewQuerySchema = z.object({
  windowDays: z.coerce.number().int().optional(),
});

/**
 * `/metrics` — read side of the governance dashboard.
 *
 * Own router and not another `caseRouter` route because it does not return
 * cases: it returns aggregated tenant counts, and none of its readers
 * (ADMIN, AUDITOR, the organization) can touch a case.
 */
export function metricsRouter(deps: MetricsRouterDeps): Router {
  const router = Router();

  router.get('/metrics/overview', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(overviewQuerySchema, req.query);
    const snapshot = await deps.getFraudMetrics({ auth, windowDays: query.windowDays });
    res.status(200).json(snapshot);
  });

  return router;
}
