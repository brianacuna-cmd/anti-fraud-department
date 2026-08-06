import { Router } from 'express';
import { parsePaginationParams } from '../../../../../../shared/http/pagination.js';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateOrganizationWithAdminUseCase } from '../../../../application/CreateOrganizationWithAdmin.js';
import type { createGetOrganizationUseCase } from '../../../../application/GetOrganization.js';
import type { createListOrganizationsUseCase } from '../../../../application/ListOrganizations.js';
import type { createPatchOrganizationIdentityUseCase } from '../../../../application/PatchOrganizationIdentity.js';
import type { createTransitionOrganizationStatusUseCase } from '../../../../application/TransitionOrganizationStatus.js';
import type { createDeleteOrganizationUseCase } from '../../../../application/DeleteOrganization.js';
import {
  createOrganizationSchema,
  patchOrganizationSchema,
  updateOrganizationStatusSchema,
} from './dto/organizationSchemas.js';
import { toOrganizationListResponse, toOrganizationResponse } from './mappers/OrganizationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface OrganizationRouterDeps {
  readonly createOrganizationWithAdmin: ReturnType<typeof createCreateOrganizationWithAdminUseCase>;
  readonly getOrganization: ReturnType<typeof createGetOrganizationUseCase>;
  readonly listOrganizations: ReturnType<typeof createListOrganizationsUseCase>;
  readonly patchOrganizationIdentity: ReturnType<typeof createPatchOrganizationIdentityUseCase>;
  readonly transitionOrganizationStatus: ReturnType<typeof createTransitionOrganizationStatusUseCase>;
  readonly deleteOrganization: ReturnType<typeof createDeleteOrganizationUseCase>;
}

/**
 * `/organizations` routes (platform-admin only, design D3). Express 5
 * forwards a rejected handler promise to `errorHandler` automatically — no
 * manual try/catch needed here.
 */
export function organizationRouter(deps: OrganizationRouterDeps): Router {
  const router = Router();

  router.post('/organizations', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createOrganizationSchema, req.body);
    const organization = await deps.createOrganizationWithAdmin({ auth, ...body });
    res.status(201).json(toOrganizationResponse(organization));
  });

  router.get('/organizations', async (req, res) => {
    const auth = requireAuthContext(req);
    const { limit, cursor } = parsePaginationParams(req.query);
    const page = await deps.listOrganizations({ auth, limit, cursor });
    res.status(200).json(toOrganizationListResponse(page));
  });

  router.get('/organizations/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const organization = await deps.getOrganization({ auth, organizationId: req.params.id! });
    res.status(200).json(toOrganizationResponse(organization));
  });

  router.patch('/organizations/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(patchOrganizationSchema, req.body);
    const organization = await deps.patchOrganizationIdentity({
      auth,
      organizationId: req.params.id!,
      ...body,
    });
    res.status(200).json(toOrganizationResponse(organization));
  });

  router.patch('/organizations/:id/status', async (req, res) => {
    const auth = requireAuthContext(req);
    const { status } = parseRequest(updateOrganizationStatusSchema, req.body);
    const organization = await deps.transitionOrganizationStatus({
      auth,
      organizationId: req.params.id!,
      next: status,
    });
    res.status(200).json(toOrganizationResponse(organization));
  });

  router.delete('/organizations/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const organization = await deps.deleteOrganization({ auth, organizationId: req.params.id! });
    res.status(200).json(toOrganizationResponse(organization));
  });

  return router;
}
