import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createProvisionAdminOrganizationUseCase } from '../../../../application/admin/ProvisionAdminOrganization.js';
import { provisionAdminOrganizationSchema } from './dto/adminSchemas.js';
import { toAdminOrganizationResponse } from './mappers/AdminOrganizationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface AdminOrganizationRouterDeps {
  readonly provisionAdminOrganization: ReturnType<typeof createProvisionAdminOrganizationUseCase>;
}

/**
 * `/admin-organizations` routes (platform-admin only, design D31/D32). PR 1c
 * scope: provisioning only. One-time private-key download, rotation, and
 * revocation are added in later PRs (2a/2c) on this same router.
 *
 * `requirePlatformAdmin` gates this route (enforced inside the use case),
 * which means it genuinely cannot provision the FIRST `AdminOrganization` —
 * that chicken-and-egg is resolved out-of-band by the bootstrap script
 * (design D43, PR 2b), not by this route.
 */
export function adminOrganizationRouter(deps: AdminOrganizationRouterDeps): Router {
  const router = Router();

  router.post('/admin-organizations', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(provisionAdminOrganizationSchema, req.body);
    const admin = await deps.provisionAdminOrganization({ auth, ...body });
    res.status(201).json(toAdminOrganizationResponse(admin));
  });

  return router;
}
