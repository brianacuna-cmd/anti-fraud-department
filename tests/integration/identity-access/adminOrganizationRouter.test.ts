import { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { adminOrganizationRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/adminOrganizationRouter.js';
import { createProvisionAdminOrganizationUseCase } from '../../../src/modules/identity-access/application/admin/ProvisionAdminOrganization.js';
import { InMemoryAdminOrganizationRepository } from '../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { FakeAdminKeyPairGenerator } from '../../helpers/identity-access/FakeAdminKeyPairGenerator.js';
import { AesGcmSecretCipher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { generateAdminOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { generateAdminKeyId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';

const PLATFORM_ADMIN = createAuthContext({ userId: 'admin-1', organizationId: null, isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: 'user-1', organizationId: 'o1', isPlatformAdmin: false });

function buildApp(actorPerRequest: () => AuthContext): {
  app: Express;
  admins: InMemoryAdminOrganizationRepository;
} {
  const admins = new InMemoryAdminOrganizationRepository();
  const keyPairs = new FakeAdminKeyPairGenerator();
  const cipher = new AesGcmSecretCipher('router-test-secret', 1);
  const clock = new SystemClock();

  const router = adminOrganizationRouter({
    provisionAdminOrganization: createProvisionAdminOrganizationUseCase({
      admins,
      keyPairs,
      cipher,
      clock,
      generateAdminOrganizationId,
      generateAdminKeyId,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actorPerRequest());
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(identityAccessErrorStatus),
  });

  return { app, admins };
}

describe('adminOrganizationRouter (e2e, in-memory repository)', () => {
  it('POST /admin-organizations provisions a new AdminOrganization for a platform-admin', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);

    const response = await request(app)
      .post('/api/v1/admin-organizations')
      .send({ email: 'root@platform.internal' });

    expect(response.status).toBe(201);
    expect(response.body.email).toBe('root@platform.internal');
    expect(response.body.keys).toHaveLength(1);
    expect(response.body.keys[0].status).toBe('ACTIVE');
    expect(response.body.keys[0].publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('the 201 response body never includes the private key or its ciphertext', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);

    const response = await request(app)
      .post('/api/v1/admin-organizations')
      .send({ email: 'root@platform.internal' });

    const bodyString = JSON.stringify(response.body);
    expect(bodyString).not.toContain('privateKey');
    expect(bodyString).not.toContain('encryptedPrivateKey');
    expect(bodyString).not.toContain('BEGIN PRIVATE KEY');
  });

  it('rejects a non-platform-admin with 403 FORBIDDEN_CROSS_TENANT', async () => {
    const { app } = buildApp(() => REGULAR_USER);

    const response = await request(app)
      .post('/api/v1/admin-organizations')
      .send({ email: 'root@platform.internal' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('rejects an empty email with 400 INVARIANT_VIOLATION', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);

    const response = await request(app).post('/api/v1/admin-organizations').send({ email: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});
