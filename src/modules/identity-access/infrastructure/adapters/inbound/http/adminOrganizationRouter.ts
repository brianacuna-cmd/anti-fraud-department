import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createProvisionAdminOrganizationUseCase } from '../../../../application/admin/ProvisionAdminOrganization.js';
import type { createRequestAdminChallengeUseCase } from '../../../../application/admin/RequestAdminChallenge.js';
import type { createVerifyAdminChallengeUseCase } from '../../../../application/admin/VerifyAdminChallenge.js';
import {
  provisionAdminOrganizationSchema,
  requestAdminChallengeSchema,
  verifyAdminChallengeSchema,
} from './dto/adminSchemas.js';
import { toAdminOrganizationResponse } from './mappers/AdminOrganizationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface AdminOrganizationRouterDeps {
  readonly provisionAdminOrganization: ReturnType<typeof createProvisionAdminOrganizationUseCase>;
  /** super-admin-auth PR1, step 1 — public, no `AuthContext` yet. */
  readonly requestAdminChallenge: ReturnType<typeof createRequestAdminChallengeUseCase>;
  /** super-admin-auth PR1, step 2 — public, no `AuthContext` yet. */
  readonly verifyAdminChallenge: ReturnType<typeof createVerifyAdminChallengeUseCase>;
}

/**
 * `/admin-organizations` routes (design D31/D32, super-admin-auth PR1).
 * Provisioning stays platform-admin-only (`requirePlatformAdmin`, enforced
 * inside the use case) — it genuinely cannot provision the FIRST
 * `AdminOrganization`, resolved out-of-band by the bootstrap script (design
 * D43). One-time private-key download, rotation, and revocation are added
 * in later PRs (2a/2b) on this same router.
 *
 * The two challenge-login routes (`POST .../challenges`, `POST .../sessions`)
 * are deliberately PUBLIC — they ARE the login, exactly like `authRouter`'s
 * login routes — so they omit `requireAuthContext` entirely (design
 * "HTTP (public login routes on adminOrganizationRouter.ts)").
 */
export function adminOrganizationRouter(deps: AdminOrganizationRouterDeps): Router {
  const router = Router();

  router.post('/admin-organizations', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(provisionAdminOrganizationSchema, req.body);
    const admin = await deps.provisionAdminOrganization({ auth, ...body });
    res.status(201).json(toAdminOrganizationResponse(admin));
  });

  router.post('/admin-organizations/challenges', async (req, res) => {
    const body = parseRequest(requestAdminChallengeSchema, req.body);
    const result = await deps.requestAdminChallenge(body);
    res.status(201).json(result);
  });

  router.post('/admin-organizations/sessions', async (req, res) => {
    const body = parseRequest(verifyAdminChallengeSchema, req.body);
    const result = await deps.verifyAdminChallenge({
      challengeId: body.challengeId,
      signatureBase64: body.signature,
      ipAddress: req.ip ?? null,
    });
    res.status(201).json({ accessToken: result.accessToken, expiresAt: result.expiresAt });
  });

  return router;
}
