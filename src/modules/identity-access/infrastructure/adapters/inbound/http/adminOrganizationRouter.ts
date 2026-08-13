import { Router } from 'express';
import type { Db } from 'mongodb';
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
} from './dto/adminSchemas.js';
import { toAdminOrganizationResponse } from './mappers/AdminOrganizationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface AdminOrganizationRouterDeps {
  readonly db?: Db;
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

export function adminOrganizationRouter(deps: AdminOrganizationRouterDeps): Router {
  const router = Router();

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

  router.post('/admin-organizations/sessions', async (req, res) => {
    const body = parseRequest(verifyAdminChallengeSchema, req.body);
    const result = await deps.verifyAdminChallenge({
      challengeId: body.challengeId,
      signatureBase64: body.signature,
      ipAddress: req.ip ?? null,
    });
    res.status(201).json({ accessToken: result.accessToken, expiresAt: result.expiresAt });
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
