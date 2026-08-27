import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { generateOtp } from './auth/generateOtp.js';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import type { Db } from 'mongodb';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createBeginUserLoginUseCase } from '../../../../application/auth/BeginUserLogin.js';
import type { createIssueSessionUseCase } from '../../../../application/auth/IssueSession.js';
import type { createAuthenticateActorUseCase } from '../../../../application/auth/AuthenticateActor.js';
import type { createIssueOrganizationSessionUseCase } from '../../../../application/auth/IssueOrganizationSession.js';
import type { createLogoutUseCase } from '../../../../application/auth/Logout.js';
import type { createRequestPasswordResetUseCase } from '../../../../application/auth/RequestPasswordReset.js';
import type { createConfirmPasswordResetUseCase } from '../../../../application/auth/ConfirmPasswordReset.js';
import type { createRefreshSessionUseCase } from '../../../../application/auth/RefreshSession.js';
import {
  usersLoginSchema,
  organizationsLoginSchema,
  organizationsOtpVerifySchema,
  organizationsMfaSchema,
  usersMfaSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  refreshSchema,
} from './dto/authSchemas.js';
import { parseRequest } from './parseRequest.js';

import type { EmailSender } from '../../../../domain/ports/EmailSender.js';

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
  /**
   * ORGANIZATION credential check for step 1 of login.
   *
   * REQUIRED on purpose. While it was optional, `main.ts` stopped injecting
   * it with nothing warning: step 1 answered `OTP_REQUIRED` to any email
   * — sending them mail — and credentials were not checked until step 3.
   * A security gate that silently disables itself when its dependency is
   * missing is worse than not having it, so forgetting it is now a compile
   * error.
   */
  readonly authenticateOrganization: ReturnType<typeof createAuthenticateActorUseCase>;
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
  /**
   * REQUIRED: organization-login step 1 OTP goes out through here. While it
   * was optional, `main.ts` stopped injecting it and the flow answered
   * `OTP_REQUIRED` without sending anything, leaving the user waiting for a
   * code that never left.
   */
  readonly emailSender: EmailSender;
  /**
   * REQUIRED: steps 2 and 3 read and persist the TOTP secret. Without it
   * enrollment is not saved and every login asks for the QR again.
   */
  readonly db: Db;
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

  // Organization 3-step 2FA pending state & enrolled TOTP secrets
  /**
   * The OTP expires and admits a bounded number of attempts. Without the
   * first, a code stayed valid indefinitely; without the second, six digits
   * are brute-forceable by trying. When attempts are exhausted the whole
   * pending login is discarded, so the user must authenticate again from
   * step 1.
   */
  const ORG_OTP_TTL_MS = 10 * 60 * 1000;
  const ORG_OTP_MAX_ATTEMPTS = 5;

  const pendingOrgLogins = new Map<
    string,
    {
      email: string;
      password: string;
      otp: string;
      challengeToken: string;
      totpSecret?: string;
      expiresAt: number;
      attempts: number;
    }
  >();

  router.post('/auth/organizations/login', async (req, res) => {
    const body = parseRequest(organizationsLoginSchema, req.body);

    // Password is verified HERE, before anything else. Previously it was
    // only stored and not checked until step 3, so an invalid credential
    // advanced to the OTP screen and triggered an email: rejection arrived
    // two steps late and anyone could provoke sends to that address.
    // Throws `invalidCredentials` (401), same as user login.
    await deps.authenticateOrganization({
      email: body.email,
      password: body.password,
      ipAddress: req.ip ?? null,
    });

    // Step 1: Generate OTP for email step
    const otp = generateOtp();
    const challengeToken = 'org_chal_' + randomUUID();

    pendingOrgLogins.set(body.email.toLowerCase(), {
      email: body.email,
      password: body.password,
      otp,
      challengeToken,
      expiresAt: Date.now() + ORG_OTP_TTL_MS,
      attempts: 0,
    });

    // Do not await the send: the response must not depend on the mail
    // provider's latency. But failure IS logged — swallowing it left the
    // user waiting for a code that never left, with no trace of why.
    void deps.emailSender
      .send({
        from: 'fraud@backendstudio.tech',
        to: body.email,
        subject: 'Código OTP de Inicio de Sesión - AntiFraud',
        text: `Tu código de verificación OTP para ingresar es: ${otp}`,
        html: `<h2>Código de Verificación</h2><p>Tu código OTP de 6 dígitos para ingresar es: <strong>${otp}</strong></p>`,
      })
      .catch((error: unknown) => {
        console.error(`[auth] no se pudo enviar el OTP de organizacion a ${body.email}:`, error);
      });

    res.status(200).json({
      status: 'OTP_REQUIRED',
      email: body.email,
      message: 'Código OTP enviado al email de la Organización',
    });
  });

  router.post('/auth/organizations/otp/verify', async (req, res) => {
    const body = parseRequest(organizationsOtpVerifySchema, req.body);
    const emailKey = body.email.toLowerCase();
    const pending = pendingOrgLogins.get(emailKey);

    if (!pending || pending.expiresAt < Date.now()) {
      if (pending) pendingOrgLogins.delete(emailKey);
      res.status(401).json({ message: 'Código OTP de Email incorrecto o expirado' });
      return;
    }

    if (pending.otp !== body.otp) {
      pending.attempts += 1;
      // Exhausted attempts invalidate the pending login: otherwise every 401
      // left the same live code for the next try, at no cost.
      if (pending.attempts >= ORG_OTP_MAX_ATTEMPTS) pendingOrgLogins.delete(emailKey);
      res.status(401).json({ message: 'Código OTP de Email incorrecto o expirado' });
      return;
    }

    // Already-enrolled TOTP secret, if any. snake_case names: the migration
    // to `organizations`/`users` left the PascalCase collections behind, and
    // these queries kept pointing at the old ones — they never found
    // anything, so every login repeated enrollment instead of challenging
    // the existing factor.
    let existingSecret: string | null = null;
    {
      const pattern = `^${emailKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
      const emailFilter = { email: { $regex: pattern, $options: 'i' } };

      const orgDoc = await deps.db.collection('organizations').findOne(emailFilter);
      if (typeof orgDoc?.mfa_secret === 'string' && orgDoc.mfa_secret.length > 0) {
        existingSecret = orgDoc.mfa_secret;
      } else {
        const userDoc = await deps.db.collection('users').findOne({ ...emailFilter, 'mfa.enabled': true });
        const secret = (userDoc?.mfa as { secret?: unknown } | undefined)?.secret;
        if (typeof secret === 'string' && secret.length > 0) {
          existingSecret = secret;
        }
      }
    }

    if (existingSecret) {
      // Organization has ALREADY enrolled TOTP -> challenge path
      pending.totpSecret = existingSecret;
      res.status(200).json({
        status: 'MFA_CHALLENGE_REQUIRED',
        challengeToken: pending.challengeToken,
      });
      return;
    }

    // Organization has NOT enrolled TOTP yet -> enrollment path (generate QR Code)
    const secret = authenticator.generateSecret();
    pending.totpSecret = secret;
    const otpauth = authenticator.keyuri(pending.email, 'AntiFraud Org', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    res.status(200).json({
      status: 'MFA_ENROLLMENT_REQUIRED',
      challengeToken: pending.challengeToken,
      qrCodeUrl,
      secret,
    });
  });

  router.post('/auth/organizations/mfa', async (req, res) => {
    const body = parseRequest(organizationsMfaSchema, req.body);
    let matchedEmail: string | null = null;
    let matchedCreds: { email: string; password: string; totpSecret?: string; expiresAt: number } | null = null;

    for (const [emailKey, pending] of pendingOrgLogins.entries()) {
      if (pending.challengeToken === body.challengeToken) {
        matchedEmail = emailKey;
        matchedCreds = pending;
        break;
      }
    }

    if (!matchedCreds || !matchedEmail || !matchedCreds.totpSecret || matchedCreds.expiresAt < Date.now()) {
      if (matchedEmail) pendingOrgLogins.delete(matchedEmail);
      res.status(401).json({ message: 'Challenge de Organización inválido o expirado' });
      return;
    }

    // Verify TOTP code against secret
    const isValidTotp = authenticator.check(body.totp, matchedCreds.totpSecret);
    if (!isValidTotp) {
      res.status(401).json({ message: 'Código TOTP de la App Autenticadora incorrecto' });
      return;
    }

    // Persist the newly enrolled TOTP secret. `updated_at` goes as Date, not
    // as an ISO string: the rest of the schema types it that way, and storing
    // it as text broke any reader that treated it as a date.
    {
      const pattern = `^${matchedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
      const emailFilter = { email: { $regex: pattern, $options: 'i' } };
      const now = new Date();

      await deps.db
        .collection('organizations')
        .updateOne(emailFilter, { $set: { mfa_secret: matchedCreds.totpSecret, updated_at: now } });

      // The admin user mirrors the same factor, so their record shows MFA
      // as active.
      await deps.db.collection('users').updateMany(emailFilter, {
        $set: { 'mfa.secret': matchedCreds.totpSecret, 'mfa.enabled': true, updated_at: now },
      });
    }

    pendingOrgLogins.delete(matchedEmail);

    const result = await deps.issueOrganizationSession({
      email: matchedCreds.email,
      password: matchedCreds.password,
      ipAddress: req.ip ?? null,
    });

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
