import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createAuthenticateActorUseCase } from '../../../../application/auth/AuthenticateActor.js';
import type { createBeginUserLoginUseCase } from '../../../../application/auth/BeginUserLogin.js';
import type { createIssueSessionUseCase } from '../../../../application/auth/IssueSession.js';
import type { createLogoutUseCase } from '../../../../application/auth/Logout.js';
import { usersLoginSchema, organizationsLoginSchema, usersMfaSchema } from './dto/authSchemas.js';
import { parseRequest } from './parseRequest.js';

export interface AuthRouterDeps {
  /**
   * Replaces `authenticateUser` (two-step-login PR2, design "Technical
   * Approach"): the USER-tier login route now branches on MFA state and
   * returns a scoped token, never a bare `{status:'AUTHENTICATED'}` stub.
   */
  readonly beginUserLogin: ReturnType<typeof createBeginUserLoginUseCase>;
  /**
   * ORGANIZATION tier is unchanged and OUT OF SCOPE for two-step-login
   * (design "Technical Approach": "ORGANIZATION tier out of scope — login
   * unchanged") — still the Phase 4 stub response.
   */
  readonly authenticateOrganization: ReturnType<typeof createAuthenticateActorUseCase>;
  /** Step 2, challenge path (design "IssueSession flow"). */
  readonly issueSession: ReturnType<typeof createIssueSessionUseCase>;
  readonly logout: ReturnType<typeof createLogoutUseCase>;
}

/**
 * `/auth` routes (design File Changes: `authRouter.ts` + `authSchemas.ts`).
 *
 * `POST /auth/users/login` now returns a single-use scoped token instead of
 * a session (spec "Challenge issuance for MFA-enabled users" /
 * "Enrollment token for MFA-disabled users") — `BeginUserLogin` decides
 * which. `POST /auth/users/mfa` is the new step-2 challenge-path endpoint
 * (design "IssueSession flow") — the ONLY route that mints a real `Sessions`
 * row for the USER tier's MFA-enabled path in this PR (PR3 adds the
 * enrollment hand-off via `ActivateMfa`).
 *
 * `POST /auth/organizations/login` is untouched — ORGANIZATION never
 * branches on MFA (design: hardcoded `mfa.enabled=false`).
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
    // ipAddress is injected OUTSIDE the parsed body (design D-A7/§4a) — it
    // is not user input, it comes from `req.ip` (honors `trust proxy`).
    const result = await deps.beginUserLogin({ ...body, ipAddress: req.ip ?? null });
    if (result.kind === 'challenge') {
      res.status(200).json({ status: 'MFA_CHALLENGE_REQUIRED', challengeToken: result.token });
      return;
    }
    res.status(200).json({ status: 'MFA_ENROLLMENT_REQUIRED', enrollmentToken: result.token });
  });

  router.post('/auth/users/mfa', async (req, res) => {
    const body = parseRequest(usersMfaSchema, req.body);
    const result = await deps.issueSession({ ...body, ipAddress: req.ip ?? null });
    res.status(200).json(result);
  });

  router.post('/auth/organizations/login', async (req, res) => {
    const body = parseRequest(organizationsLoginSchema, req.body);
    await deps.authenticateOrganization({ ...body, ipAddress: req.ip ?? null });
    res.status(200).json({ status: 'AUTHENTICATED' });
  });

  router.post('/auth/logout', async (req, res) => {
    const auth = requireAuthContext(req);
    await deps.logout({ auth });
    res.status(204).send();
  });

  return router;
}
