import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGetOrganizationFraudConfigUseCase } from '../../../../application/GetOrganizationFraudConfig.js';
import type { createUpsertOrganizationFraudConfigUseCase } from '../../../../application/UpsertOrganizationFraudConfig.js';
import { upsertOrganizationFraudConfigSchema } from './dto/organizationFraudConfigSchemas.js';
import { toOrganizationFraudConfigResponse } from './mappers/OrganizationFraudConfigHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface OrganizationFraudConfigRouterDeps {
  readonly getOrganizationFraudConfig: ReturnType<typeof createGetOrganizationFraudConfigUseCase>;
  readonly upsertOrganizationFraudConfig: ReturnType<typeof createUpsertOrganizationFraudConfigUseCase>;
}

/**
 * `/organization-fraud-config` routes — Get/Upsert for the per-tenant
 * fraud config singleton (SLA minutes + risk thresholds). Express 5
 * forwards rejected handler promises to `errorHandler` automatically.
 */
export function organizationFraudConfigRouter(deps: OrganizationFraudConfigRouterDeps): Router {
  const router = Router();

  router.get('/organization-fraud-config', async (req, res) => {
    const auth = requireAuthContext(req);
    const config = await deps.getOrganizationFraudConfig({ auth });
    res.status(200).json(toOrganizationFraudConfigResponse(config));
  });

  router.put('/organization-fraud-config', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(upsertOrganizationFraudConfigSchema, req.body);
    const config = await deps.upsertOrganizationFraudConfig({ auth, ...body });
    res.status(200).json(toOrganizationFraudConfigResponse(config));
  });

  return router;
}
