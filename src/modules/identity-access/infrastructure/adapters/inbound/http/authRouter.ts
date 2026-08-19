import { Router } from 'express';
import { randomUUID } from 'node:crypto';
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
  /** Verificación de credenciales de ORGANIZATION para el paso 1 del login. */
  readonly authenticateOrganization?: ReturnType<typeof createAuthenticateActorUseCase>;
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
  readonly emailSender?: EmailSender;
  readonly db?: Db;
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
   * El OTP caduca y admite un número acotado de intentos. Sin lo primero un
   * código seguía siendo válido indefinidamente; sin lo segundo, seis dígitos
   * son forzables probando. Al agotarse los intentos se descarta el pendiente
   * entero, así que hay que volver a autenticarse desde el paso 1.
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

    // La contraseña se verifica AQUÍ, antes de nada. Antes solo se guardaba y
    // no se comprobaba hasta el paso 3, así que una credencial inválida
    // avanzaba a la pantalla de OTP y disparaba un correo: el rechazo llegaba
    // dos pasos tarde y cualquiera podía provocar envíos a esa dirección.
    // Lanza `invalidCredentials` (401), igual que el login de usuario.
    if (deps.authenticateOrganization) {
      await deps.authenticateOrganization({
        email: body.email,
        password: body.password,
        ipAddress: req.ip ?? null,
      });
    }

    // Step 1: Generate OTP for email step
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const challengeToken = 'org_chal_' + randomUUID();

    pendingOrgLogins.set(body.email.toLowerCase(), {
      email: body.email,
      password: body.password,
      otp,
      challengeToken,
      expiresAt: Date.now() + ORG_OTP_TTL_MS,
      attempts: 0,
    });

    if (deps.emailSender) {
      deps.emailSender.send({
        from: 'fraud@backendstudio.tech',
        to: body.email,
        subject: 'Código OTP de Inicio de Sesión - AntiFraud',
        text: `Tu código de verificación OTP para ingresar es: ${otp}`,
        html: `<h2>Código de Verificación</h2><p>Tu código OTP de 6 dígitos para ingresar es: <strong>${otp}</strong></p>`,
      }).catch(() => {});
    }

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
      // Agotados los intentos se invalida el pendiente: si no, cada 401 dejaba
      // el mismo código vivo para el siguiente intento, sin coste alguno.
      if (pending.attempts >= ORG_OTP_MAX_ATTEMPTS) pendingOrgLogins.delete(emailKey);
      res.status(401).json({ message: 'Código OTP de Email incorrecto o expirado' });
      return;
    }

    // Read persistent MfaSecret directly from MongoDB collection Organizations or Users
    let existingSecret: string | null = null;
    if (deps.db) {
      const pattern = `^${emailKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
      const orgDoc = await deps.db.collection('Organizations').findOne({ Email: { $regex: pattern, $options: 'i' } });
      if (orgDoc?.MfaSecret) {
        existingSecret = orgDoc.MfaSecret as string;
      } else {
        const userDoc = await deps.db.collection('Users').findOne({ Email: { $regex: pattern, $options: 'i' }, 'Mfa.Enabled': true });
        if (userDoc?.Mfa?.Secret) {
          existingSecret = userDoc.Mfa.Secret as string;
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

    // Save TOTP secret in MongoDB collection Organizations and Users
    if (deps.db) {
      const pattern = `^${matchedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
      await deps.db.collection('Organizations').updateOne(
        { Email: { $regex: pattern, $options: 'i' } },
        { $set: { MfaSecret: matchedCreds.totpSecret, UpdatedAt: new Date().toISOString() } }
      );

      // Synchronize in Users collection so admin user document also shows MFA active
      await deps.db.collection('Users').updateMany(
        { Email: { $regex: pattern, $options: 'i' } },
        {
          $set: {
            'Mfa.Secret': matchedCreds.totpSecret,
            'Mfa.Enabled': true,
            UpdatedAt: new Date().toISOString(),
          },
        }
      );
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
