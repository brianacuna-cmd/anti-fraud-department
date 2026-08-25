import { Router } from 'express';
import { z } from 'zod';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGetFraudMetricsUseCase } from '../../../../application/GetFraudMetrics.js';
import { parseRequest } from './parseRequest.js';

export interface MetricsRouterDeps {
  readonly getFraudMetrics: ReturnType<typeof createGetFraudMetricsUseCase>;
}

/**
 * `windowDays` llega como cadena en el query string. `coerce` la convierte
 * antes de validar; el rango real (1..365) lo comprueba el caso de uso, que
 * es donde vive la razon del tope.
 */
const overviewQuerySchema = z.object({
  windowDays: z.coerce.number().int().optional(),
});

/**
 * `/metrics` — lado de lectura del panel de gobierno.
 *
 * Router propio y no una ruta mas de `caseRouter` porque no devuelve casos:
 * devuelve conteos agregados del inquilino, y ninguno de sus lectores
 * (ADMIN, AUDITOR, la organizacion) puede tocar un expediente.
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
