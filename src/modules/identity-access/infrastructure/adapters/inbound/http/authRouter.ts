import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createBeginUserLoginUseCase } from '../../../../application/auth/BeginUserLogin.js';
import type { createIssueSessionUseCase } from '../../../../application/auth/IssueSession.js';
import type { createIssueOrganizationSessionUseCase } from '../../../../application/auth/IssueOrganizationSession.js';
import type { createLogoutUseCase } from '../../../../application/auth/Logout.js';
import type { createRequestPasswordResetUseCase } from '../../../../application/auth/RequestPasswordReset.js';
import type { createConfirmPasswordResetUseCase } from '../../../../application/auth/ConfirmPasswordReset.js';
import type { createRefreshSessionUseCase } from '../../../../application/auth/RefreshSession.js';
import {
  usersLoginSchema,
  organizationsLoginSchema,
  usersMfaSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  refreshSchema,
} from './dto/authSchemas.js';
import { parseRequest } from './parseRequest.js';

export interface AuthRouterDeps {
  /**
   * Replaces `authenticateUser` (two-step-login PR2, design "Technical
   * Approach"): the USER-tier login route now branches on MFA state and
   * returns a scoped token, never a bare `{status:'AUTHENTICATED'}` stub.
   */
  readonly beginUserLogin: ReturnType<typeof createBeginUserLoginUseCase>;
  /**
   * ORGANIZATION tier login (session-lifecycle PR-1, design "1. ORG login
   * use case"): single-step, mints a real ACCESS+REFRESH session directly —
   * no MFA branch, unlike the USER tier's two-step flow.
   */
  readonly issueOrganizationSession: ReturnType<typeof createIssueOrganizationSessionUseCase>;
  /** Step 2, challenge path (design "IssueSession flow"). */
  readonly issueSession: ReturnType<typeof createIssueSessionUseCase>;
  readonly logout: ReturnType<typeof createLogoutUseCase>;
  /** Public, unauthenticated (password-management PR-2b, spec "Request Password Reset"). */
  readonly requestPasswordReset: ReturnType<typeof createRequestPasswordResetUseCase>;
  /** Public, unauthenticated, token-only (password-management PR-2c, spec "Confirm Password Reset"). */
  readonly confirmPasswordReset: ReturnType<typeof createConfirmPasswordResetUseCase>;
  /**
   * `POST /auth/refresh` (session-lifecycle PR-2, design "3. `/auth/refresh`
   * route + DTO") — public, unauthenticated: the refresh token itself IS the
   * credential, so this route never calls `requireAuthContext`.
   */
  readonly refreshSession: ReturnType<typeof createRefreshSessionUseCase>;
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
 * `POST /auth/organizations/login` mints a real session directly
 * (session-lifecycle PR-1) — ORGANIZATION never branches on MFA (design:
 * hardcoded `mfa.enabled=false`), so there is no separate challenge step.
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
    const result = await deps.issueOrganizationSession({ ...body, ipAddress: req.ip ?? null });
    res.status(200).json(result);
  });

  // session-lifecycle PR-2 (design "3. `/auth/refresh` route + DTO",
  // DD4) — UNAUTHENTICATED: never calls `requireAuthContext`, the refresh
  // token in the body IS the credential. Every semantic failure (unknown,
  // wrong tokenType, revoked, reuse, CAS-loss, expired refresh/family)
  // collapses to the SAME opaque `SESSION_INVALID` 401 — no branch here
  // distinguishes them.
  router.post('/auth/refresh', async (req, res) => {
    const body = parseRequest(refreshSchema, req.body);
    const result = await deps.refreshSession({ refreshToken: body.refreshToken, ipAddress: req.ip ?? null });
    res.status(200).json(result);
  });

  router.post('/auth/logout', async (req, res) => {
    const auth = requireAuthContext(req);
    await deps.logout({ auth });
    res.status(204).send();
  });

  // password-management PR-2b (spec "Request Password Reset"): ALWAYS 200
  // opaque — no `AuthContext`, and the response body is identical whether
  // or not the email/organizationSlug resolves to a real user (design §5).
  router.post('/auth/users/password-reset/request', async (req, res) => {
    const body = parseRequest(requestPasswordResetSchema, req.body);
    const result = await deps.requestPasswordReset({ ...body, ipAddress: req.ip ?? null });
    res.status(200).json(result);
  });

  // password-management PR-2c (spec "Confirm Password Reset"): public, no
  // `organizationSlug` — the token alone carries the tenant (design §6).
  // Every rejection mode maps to the SAME opaque `PASSWORD_RESET_INVALID`
  // 400 (thrown by the use case, mapped by `errorStatus.ts`), so no branch
  // here distinguishes expired/replayed/malformed/etc.
  router.post('/auth/users/password-reset/confirm', async (req, res) => {
    const body = parseRequest(confirmPasswordResetSchema, req.body);
    await deps.confirmPasswordReset({ ...body, ipAddress: req.ip ?? null });
    res.status(204).send();
  });

  return router;
}
