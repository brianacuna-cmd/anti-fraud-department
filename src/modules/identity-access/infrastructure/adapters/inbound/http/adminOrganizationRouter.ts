import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { generateOtp } from './auth/generateOtp.js';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { ObjectId, type Db } from 'mongodb';
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
  /**
   * REQUIRED. While it was optional, `main.ts` stopped injecting it with
   * nothing warning and super-admin login degraded silently: the OTP went
   * to the default address instead of the real admin, and the TOTP secret
   * was not persisted, so every attempt asked for the QR again.
   */
  readonly db: Db;
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
  /** Sends the step-2 OTP. Without it, the email is skipped and the flow continues the same. */
  readonly emailSender?: EmailSender;
}

/** Minimal `admin_organizations` projection the MFA flow needs. */
interface AdminOrganizationMfaDocument {
  readonly _id: ObjectId;
  readonly email?: string;
  readonly mfa_secret?: string;
}

export function adminOrganizationRouter(deps: AdminOrganizationRouterDeps): Router {
  const router = Router();

  // Super-admin logins in progress, between step 1 (Ed25519 signature)
  // and step 3 (TOTP). The session is already minted by `verifyAdminChallenge`
  // but is NOT delivered until the other two factors are passed.
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
    const docs = await deps.db.collection('admin_organizations').find().toArray();
    const items = docs.map((doc) => ({
      id: String(doc._id),
      email: doc.email as string,
      keys: ((doc.keys as unknown[]) || []).map((k) => {
        const item = k as Record<string, unknown>;
        const asIso = (value: unknown): string | null => {
          if (value instanceof Date) {
            return value.toISOString();
          }
          return typeof value === 'string' ? value : null;
        };
        return {
          keyId: String(item.key_id ?? item.keyId ?? ''),
          publicKey: (item.public_key ?? item.publicKey) as string,
          status: item.status as string,
          createdAt: asIso(item.created_at ?? item.createdAt) ?? '',
          rotatedAt: asIso(item.rotated_at ?? item.rotatedAt),
          revokedAt: asIso(item.revoked_at ?? item.revokedAt),
        };
      }),
      createdAt: doc.created_at instanceof Date ? doc.created_at.toISOString() : (doc.created_at as string),
      updatedAt: doc.updated_at instanceof Date ? doc.updated_at.toISOString() : (doc.updated_at as string),
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

  // Step 1 of 3: verify the Ed25519 signature and send the OTP by email. The
  // session stays held in `pendingAdminLogins` until step 3 — returning it
  // here would turn the other two factors into decoration.
  router.post('/admin-organizations/sessions', async (req, res) => {
    const body = parseRequest(verifyAdminChallengeSchema, req.body);
    const result = await deps.verifyAdminChallenge({
      challengeId: body.challengeId,
      signatureBase64: body.signature,
      ipAddress: req.ip ?? null,
    });

    // The admin comes from the use case itself, which already loaded the
    // aggregate when verifying the signature. The previous version looked
    // it up in Mongo taking "the first with an ACTIVE key", so with more
    // than one super admin one person's OTP could land in another's inbox.
    const email = result.email;
    const adminOrgId = result.adminOrganizationId;

    const otp = generateOtp();
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
          subject: 'Codigo OTP Super Admin - AntiFraud',
          text: `Tu codigo de verificacion OTP para ingresar como Super Admin es: ${otp}`,
          html: `<h2>Verificacion Super Admin</h2><p>Tu codigo OTP de 6 digitos para ingresar es: <strong>${otp}</strong></p>`,
        })
        .catch(() => {});
    }

    res.status(200).json({
      status: 'OTP_REQUIRED',
      email,
      challengeToken,
      message: 'Codigo OTP enviado al email de Super Admin',
    });
  });

  // Step 2 of 3: validate the email OTP and choose enrollment (QR) or TOTP challenge.
  router.post('/admin-organizations/otp/verify', async (req, res) => {
    const body = parseRequest(adminOtpVerifySchema, req.body);
    const pending = pendingAdminLogins.get(body.challengeToken);

    if (!pending || pending.otp !== body.otp) {
      res.status(401).json({ message: 'Codigo OTP de Email incorrecto o expirado' });
      return;
    }

    let existingSecret: string | null = null;
    if (pending.adminOrganizationId) {
      const adminDoc = await deps.db
        .collection<AdminOrganizationMfaDocument>('admin_organizations')
        .findOne({ _id: new ObjectId(pending.adminOrganizationId) });
      if (adminDoc?.mfa_secret) {
        existingSecret = adminDoc.mfa_secret;
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

  // Step 3 of 3: validate TOTP and only then deliver the held session.
  router.post('/admin-organizations/mfa', async (req, res) => {
    const body = parseRequest(adminMfaSchema, req.body);
    const pending = pendingAdminLogins.get(body.challengeToken);

    if (!pending || !pending.totpSecret) {
      res.status(401).json({ message: 'Sesion de verificacion expirada o invalida' });
      return;
    }

    if (!authenticator.check(body.code, pending.totpSecret)) {
      res.status(401).json({ message: 'Codigo de App Autenticadora (TOTP) incorrecto' });
      return;
    }

    if (pending.adminOrganizationId) {
      await deps.db
        .collection<AdminOrganizationMfaDocument>('admin_organizations')
        .updateOne({ _id: new ObjectId(pending.adminOrganizationId) }, { $set: { mfa_secret: pending.totpSecret } });
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
