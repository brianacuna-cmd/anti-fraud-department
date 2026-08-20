import { Router } from 'express';
import { randomUUID } from 'node:crypto';
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
   * OBLIGATORIA. Mientras fue opcional, `main.ts` dejo de inyectarla sin que
   * nada lo advirtiera y el login de super admin se degrado en silencio: el
   * OTP salia hacia el correo por defecto en vez del admin real, y el secreto
   * TOTP no se persistia, de modo que cada intento volvia a pedir el QR.
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
  /** Envia el OTP del paso 2. Sin el, el correo se omite y el flujo sigue igual. */
  readonly emailSender?: EmailSender;
}

/** Proyeccion minima de `admin_organizations` que necesita el flujo de MFA. */
interface AdminOrganizationMfaDocument {
  readonly _id: ObjectId;
  readonly email?: string;
  readonly mfa_secret?: string;
}

export function adminOrganizationRouter(deps: AdminOrganizationRouterDeps): Router {
  const router = Router();

  // Logins de super admin a medio completar, entre el paso 1 (firma Ed25519)
  // y el paso 3 (TOTP). La sesion ya esta emitida por `verifyAdminChallenge`
  // pero NO se entrega hasta superar los otros dos factores.
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

  // Paso 1 de 3: verifica la firma Ed25519 y manda el OTP por correo. La
  // sesion queda retenida en `pendingAdminLogins` hasta el paso 3 — devolverla
  // aqui convertiria los otros dos factores en decorado.
  router.post('/admin-organizations/sessions', async (req, res) => {
    const body = parseRequest(verifyAdminChallengeSchema, req.body);
    const result = await deps.verifyAdminChallenge({
      challengeId: body.challengeId,
      signatureBase64: body.signature,
      ipAddress: req.ip ?? null,
    });

    // El admin viene del propio caso de uso, que ya cargo el agregado al
    // verificar la firma. La version anterior lo buscaba en Mongo tomando "el
    // primero con una llave ACTIVA", asi que con mas de un super admin el OTP
    // de uno podia acabar en el correo de otro.
    const email = result.email;
    const adminOrgId = result.adminOrganizationId;

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

  // Paso 2 de 3: valida el OTP del correo y decide enrolamiento (QR) o reto TOTP.
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

  // Paso 3 de 3: valida el TOTP y recien entonces entrega la sesion retenida.
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
