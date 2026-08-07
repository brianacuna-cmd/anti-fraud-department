import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createAuthenticateActorUseCase } from '../../../../application/auth/AuthenticateActor.js';
import type { createLogoutUseCase } from '../../../../application/auth/Logout.js';
import { usersLoginSchema, organizationsLoginSchema } from './dto/authSchemas.js';
import { parseRequest } from './parseRequest.js';

export interface AuthRouterDeps {
  readonly authenticateUser: ReturnType<typeof createAuthenticateActorUseCase>;
  readonly authenticateOrganization: ReturnType<typeof createAuthenticateActorUseCase>;
  readonly logout: ReturnType<typeof createLogoutUseCase>;
}

/**
 * `/auth` routes (design File Changes: `authRouter.ts` + `authSchemas.ts`).
 * Login responses are a deliberate PHASE 4 STUB: `{ status: 'AUTHENTICATED' }`
 * on success — the design's real response (an MFA challenge or a
 * forced-enrollment step, authentication-session spec: "Two-Step Login")
 * requires `MfaChallenges`/`TotpService`, which do not exist until Phase 5.
 * `AuthenticateActor` deliberately never issues a `Sessions` row itself
 * (design Data Flow: only `POST /auth/{tier}/mfa` does) — this router will
 * gain the real challenge/enrollment body when Phase 5 lands, without
 * `AuthenticateActor` itself changing shape.
 *
 * `POST /auth/logout` is intentionally tier-agnostic (design File Changes:
 * "/auth/logout", not "/auth/{tier}/logout") — the resolved `AuthContext`
 * already carries `sessionId`/`actorType`, so no tier prefix is needed to
 * know which session to revoke.
 */
export function authRouter(deps: AuthRouterDeps): Router {
  const router = Router();

  router.post('/auth/users/login', async (req, res) => {
    const body = parseRequest(usersLoginSchema, req.body);
    await deps.authenticateUser(body);
    res.status(200).json({ status: 'AUTHENTICATED' });
  });

  router.post('/auth/organizations/login', async (req, res) => {
    const body = parseRequest(organizationsLoginSchema, req.body);
    await deps.authenticateOrganization(body);
    res.status(200).json({ status: 'AUTHENTICATED' });
  });

  router.post('/auth/logout', async (req, res) => {
    const auth = requireAuthContext(req);
    await deps.logout({ auth });
    res.status(204).send();
  });

  return router;
}
