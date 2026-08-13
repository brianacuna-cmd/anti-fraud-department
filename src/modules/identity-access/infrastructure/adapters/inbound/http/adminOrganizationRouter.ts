import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import type { Db } from 'mongodb';
import type { EmailSender } from '../../../../domain/ports/EmailSender.js';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createProvisionAdminOrganizationUseCase } from '../../../../application/admin/ProvisionAdminOrganization.js';
import type { createRequestAdminChallengeUseCase } from '../../../../application/admin/RequestAdminChallenge.js';
import type { createVerifyAdminChallengeUseCase } from '../../../../application/admin/VerifyAdminChallenge.js';
import type { createDownloadAdminPrivateKeyUseCase } from '../../../../application/admin/DownloadAdminPrivateKey.js';
import type { createRotateAdminKeyUseCase } from '../../../../application/admin/RotateAdminKey.js';
import type { createRevokeAdminKeyUseCase } from '../../../../application/admin/RevokeAdminKey.js';
import {
  provisionAdminOrganizationSchema,
  requestAdminChallengeSchema,
  verifyAdminChallengeSchema,
  adminOtpVerifySchema,
  adminMfaSchema,
} from './dto/adminSchemas.js';
import { toAdminOrganizationResponse } from './mappers/AdminOrganizationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface AdminOrganizationRouterDeps {
  readonly db?: Db;
  readonly emailSender?: EmailSender;
  readonly provisionAdminOrganization: ReturnType<typeof createProvisionAdminOrganizationUseCase>;
  /** super-admin-auth PR1, step 1 — public, no `AuthContext` yet. */
  readonly requestAdminChallenge: ReturnType<typeof createRequestAdminChallengeUseCase>;
  /** super-admin-auth PR1, step 2 — public, no `AuthContext` yet. */
  readonly verifyAdminChallenge: ReturnType<typeof createVerifyAdminChallengeUseCase>;
  /** super-admin-auth PR2 — `requirePlatformAdmin`-gated, one-time download. */
  readonly downloadAdminPrivateKey: ReturnType<typeof createDownloadAdminPrivateKeyUseCase>;
  /** super-admin-auth PR2 — `requirePlatformAdmin`-gated. */
  readonly rotateAdminKey: ReturnType<typeof createRotateAdminKeyUseCase>;
  /** super-admin-auth PR2 — `requirePlatformAdmin`-gated. */
  readonly revokeAdminKey: ReturnType<typeof createRevokeAdminKeyUseCase>;
}

/**
 * `/admin-organizations` routes (design D31/D32, super-admin-auth PR1+PR2).
 * Provisioning stays platform-admin-only (`requirePlatformAdmin`, enforced
 * inside the use case) — it genuinely cannot provision the FIRST
 * `AdminOrganization`, resolved out-of-band by the bootstrap script (design
 * D43).
 *
 * The two challenge-login routes (`POST .../challenges`, `POST .../sessions`)
 * are deliberately PUBLIC — they ARE the login, exactly like `authRouter`'s
 * login routes — so they omit `requireAuthContext` entirely (design
 * "HTTP (public login routes on adminOrganizationRouter.ts)").
 *
 * The three PR2 key-lifecycle routes (download/rotate/revoke) are
 * authenticated (`requireAuthContext` + `requirePlatformAdmin` inside the
 * use case) — mirrors `provisionAdminOrganization`'s shape exactly.
 */
export function adminOrganizationRouter(deps: AdminOrganizationRouterDeps): Router {
  const router = Router();
  const pendingAdminLogins = new Map<
    string,
    {
      adminOrganizationId: string;
      email: string;
      otp: string;
      result: { accessToken: string; expiresAt: string };
      totpSecret?: string;
    }
  >();

  router.get('/admin-organizations', async (req, res) => {
    if (!req.authContext) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    if (req.authContext.actorType !== 'PLATFORM_ADMIN') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Platform Admin required' } });
      return;
    }
    if (!deps.db) {
      res.status(200).json([]);
      return;
    }
    const docs = await deps.db.collection('adminOrganizations').find().toArray();
    const items = docs.map((doc) => ({
      id: String(doc._id),
      email: doc.email as string,
      keys: ((doc.keys as unknown[]) || []).map((k) => {
        const item = k as Record<string, unknown>;
        return {
          keyId: item.keyId as string,
          publicKey: item.publicKey as string,
          status: item.status as string,
          createdAt: item.createdAt as string,
          rotatedAt: (item.rotatedAt as string) ?? null,
          revokedAt: (item.revokedAt as string) ?? null,
        };
      }),
      createdAt: doc.createdAt as string,
      updatedAt: doc.updatedAt as string,
    }));
    res.status(200).json(items);
  });

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

  // Step 1 of 3-step Super Admin Auth: Verify Ed25519 signature -> Generate & Send Email OTP
  router.post('/admin-organizations/sessions', async (req, res) => {
    const body = parseRequest(verifyAdminChallengeSchema, req.body);
    const result = await deps.verifyAdminChallenge({
      challengeId: body.challengeId,
      signatureBase64: body.signature,
      ipAddress: req.ip ?? null,
    });

    let email = 'superadmin@antifraud.io';
    let adminOrgId = '';
    if (deps.db) {
      const adminDoc = await deps.db.collection('adminOrganizations').findOne({ keys: { $elemMatch: { status: 'ACTIVE' } } });
      if (adminDoc) {
        email = (adminDoc.email as string) || email;
        adminOrgId = String(adminDoc._id);
      }
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const challengeToken = 'admin_chal_' + randomUUID();

    pendingAdminLogins.set(challengeToken, {
      adminOrganizationId: adminOrgId,
      email,
      otp,
      result,
    });

    if (deps.emailSender) {
      deps.emailSender
        .send({
          from: 'fraud@backendstudio.tech',
          to: email,
          subject: 'Código OTP Super Admin - AntiFraud',
          text: `Tu código de verificación OTP para ingresar como Super Admin es: ${otp}`,
          html: `<h2>Verificación Super Admin</h2><p>Tu código OTP de 6 dígitos para ingresar es: <strong>${otp}</strong></p>`,
        })
        .catch(() => { });
    }

    res.status(200).json({
      status: 'OTP_REQUIRED',
      email,
      challengeToken,
      message: 'Código OTP enviado al email de Super Admin',
    });
  });

  // Step 2 of 3-step Super Admin Auth: Verify Email OTP -> Require QR Enrollment or TOTP Challenge
  router.post('/admin-organizations/otp/verify', async (req, res) => {
    const body = parseRequest(adminOtpVerifySchema, req.body);
    const pending = pendingAdminLogins.get(body.challengeToken);

    if (!pending || pending.otp !== body.otp) {
      res.status(401).json({ message: 'Código OTP de Email incorrecto o expirado' });
      return;
    }

    let existingSecret: string | null = null;
    if (deps.db && pending.adminOrganizationId) {
      const adminDoc = await deps.db.collection<any>('adminOrganizations').findOne({ _id: pending.adminOrganizationId });
      if (adminDoc?.MfaSecret) {
        existingSecret = adminDoc.MfaSecret as string;
      }
    }

    if (existingSecret) {
      pending.totpSecret = existingSecret;
      res.status(200).json({
        status: 'MFA_CHALLENGE_REQUIRED',
        challengeToken: body.challengeToken,
      });
      return;
    }

    const secret = authenticator.generateSecret();
    pending.totpSecret = secret;
    const otpauth = authenticator.keyuri(pending.email, 'AntiFraud SuperAdmin', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    res.status(200).json({
      status: 'MFA_ENROLLMENT_REQUIRED',
      challengeToken: body.challengeToken,
      qrCodeUrl,
      secret,
    });
  });

  // Step 3 of 3-step Super Admin Auth: Verify App TOTP -> Issue Final Session Tokens
  router.post('/admin-organizations/mfa', async (req, res) => {
    const body = parseRequest(adminMfaSchema, req.body);
    const pending = pendingAdminLogins.get(body.challengeToken);

    if (!pending || !pending.totpSecret) {
      res.status(401).json({ message: 'Sesión de verificación expirada o inválida' });
      return;
    }

    const isValid = authenticator.check(body.code, pending.totpSecret);
    if (!isValid) {
      res.status(401).json({ message: 'Código de App Autenticadora (TOTP) incorrecto' });
      return;
    }

    if (deps.db && pending.adminOrganizationId) {
      await deps.db.collection<any>('adminOrganizations').updateOne(
        { _id: pending.adminOrganizationId },
        { $set: { MfaSecret: pending.totpSecret } },
      );
    }

    pendingAdminLogins.delete(body.challengeToken);
    res.status(200).json({
      accessToken: pending.result.accessToken,
      expiresAt: pending.result.expiresAt,
    });
  });

  router.post('/admin-organizations/:adminOrganizationId/keys/:keyId/download', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.downloadAdminPrivateKey({
      auth,
      adminOrganizationId: req.params.adminOrganizationId!,
      keyId: req.params.keyId!,
    });
    res.status(200).json({ privateKeyPkcs8Pem: result.privateKeyPkcs8Pem });
  });

  router.post('/admin-organizations/:adminOrganizationId/keys/rotate', async (req, res) => {
    const auth = requireAuthContext(req);
    const admin = await deps.rotateAdminKey({ auth, adminOrganizationId: req.params.adminOrganizationId! });
    res.status(200).json(toAdminOrganizationResponse(admin));
  });

  router.post('/admin-organizations/:adminOrganizationId/keys/:keyId/revoke', async (req, res) => {
    const auth = requireAuthContext(req);
    const admin = await deps.revokeAdminKey({
      auth,
      adminOrganizationId: req.params.adminOrganizationId!,
      keyId: req.params.keyId!,
    });
    res.status(200).json(toAdminOrganizationResponse(admin));
  });

  return router;
}
