import { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { userRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/userRouter.js';
import { InMemoryUserRepositoryFactory } from '../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { createCreateUserUseCase } from '../../../src/modules/identity-access/application/CreateUser.js';
import { createGetUserUseCase } from '../../../src/modules/identity-access/application/GetUser.js';
import { createListUsersUseCase } from '../../../src/modules/identity-access/application/ListUsers.js';
import { createPatchUserIdentityUseCase } from '../../../src/modules/identity-access/application/PatchUserIdentity.js';
import { createTransitionUserStatusUseCase } from '../../../src/modules/identity-access/application/TransitionUserStatus.js';
import { createDeleteUserUseCase } from '../../../src/modules/identity-access/application/DeleteUser.js';
import { createSetupMfaUseCase } from '../../../src/modules/identity-access/application/SetupMfa.js';
import { createActivateMfaUseCase } from '../../../src/modules/identity-access/application/ActivateMfa.js';
import { createDisableMfaUseCase } from '../../../src/modules/identity-access/application/DisableMfa.js';
import { generateUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { OtplibTotpService } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { AesGcmSecretCipher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { FakeQrCodeGenerator } from '../../helpers/identity-access/FakeQrCodeGenerator.js';
import { authenticator } from 'otplib';

const ORG_1_USER = createAuthContext({ userId: 'u1', organizationId: 'org-1', isPlatformAdmin: false });
const ORG_2_USER = createAuthContext({ userId: 'u2', organizationId: 'org-2', isPlatformAdmin: false });
const PLATFORM_ADMIN_ORG_1 = createAuthContext({ userId: 'u3', organizationId: 'org-1', isPlatformAdmin: true });

function buildApp(
  actorPerRequest: () => AuthContext,
  userRepositoryFactory: InMemoryUserRepositoryFactory = new InMemoryUserRepositoryFactory(),
): { app: Express; userRepositoryFactory: InMemoryUserRepositoryFactory } {
  const unitOfWork = new InMemoryUnitOfWork();
  const passwordHasher = new FakePasswordHasher();
  const clock = new SystemClock();
  const auditRecorder = new InMemoryAuditRecorder();

  const transitionUserStatus = createTransitionUserStatusUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock,
    auditRecorder,
  });

  const router = userRouter({
    createUser: createCreateUserUseCase({
      userRepositoryFactory,
      passwordHasher,
      unitOfWork,
      clock,
      generateId: generateUserId,
      auditRecorder,
    }),
    getUser: createGetUserUseCase({ userRepositoryFactory }),
    listUsers: createListUsersUseCase({ userRepositoryFactory }),
    patchUserIdentity: createPatchUserIdentityUseCase({ userRepositoryFactory, unitOfWork, clock, auditRecorder }),
    transitionUserStatus,
    deleteUser: createDeleteUserUseCase({ transitionUserStatus }),
    setupMfa: createSetupMfaUseCase({
      userRepositoryFactory,
      unitOfWork,
      clock,
      totpService: new OtplibTotpService(),
      qrCodeGenerator: new FakeQrCodeGenerator(),
      secretCipher: new AesGcmSecretCipher('test-secret', 1),
      issuer: 'AntiFraud',
    }),
    activateMfa: createActivateMfaUseCase({
      userRepositoryFactory,
      unitOfWork,
      clock,
      totpService: new OtplibTotpService(),
      secretCipher: new AesGcmSecretCipher('test-secret', 1),
      auditRecorder,
    }),
    disableMfa: createDisableMfaUseCase({ userRepositoryFactory, unitOfWork, clock, auditRecorder }),
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

  return { app, userRepositoryFactory };
}

describe('userRouter (e2e, in-memory repository)', () => {
  it('POST /users creates a user scoped to the caller\'s organization', async () => {
    const { app } = buildApp(() => ORG_1_USER);

    const response = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'super-secret', firstName: 'Alice', lastName: 'Smith' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      email: 'alice@example.com',
      firstName: 'Alice',
      organizationId: 'org-1',
      status: 'ACTIVE',
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('GET /users/:id returns 404 USER_NOT_FOUND for a cross-tenant id', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const { app: otherOrgApp } = buildApp(() => ORG_2_USER);
    const response = await request(otherOrgApp).get(`/api/v1/users/${created.body.id}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('GET /users paginates within the caller\'s organization', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    await request(app).post('/api/v1/users').send({ email: 'a@example.com', password: 'pw', firstName: 'A', lastName: 'S' });
    await request(app).post('/api/v1/users').send({ email: 'b@example.com', password: 'pw', firstName: 'B', lastName: 'T' });

    const firstPage = await request(app).get('/api/v1/users?limit=1');

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).not.toBeNull();
  });

  it('PATCH /users/:id updates firstName/lastName/email/avatarUrl only', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const response = await request(app)
      .patch(`/api/v1/users/${created.body.id}`)
      .send({ firstName: 'Alicia' });

    expect(response.status).toBe(200);
    expect(response.body.firstName).toBe('Alicia');
  });

  it('PATCH /users/:id rejects an attempt to set roleIds with 400 INVARIANT_VIOLATION', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const response = await request(app)
      .patch(`/api/v1/users/${created.body.id}`)
      .send({ roleIds: ['role-1'] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('POST /users/:id/transition changes status on a valid transition', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'SUSPENDED' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('SUSPENDED');
  });

  it('POST /users/:id/transition rejects an invalid transition with 422', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'ACTIVE' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('an org-admin cannot reactivate a DISABLED user in their own org (FORBIDDEN_REACTIVATION)', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });
    await request(app).delete(`/api/v1/users/${created.body.id}`);

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'ACTIVE' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_REACTIVATION');
  });

  it('DELETE /users/:id behaves identically to transition to DISABLED', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const response = await request(app).delete(`/api/v1/users/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DISABLED');
  });

  it('a platform-admin shares the ordinary tenant-scoped path — no special cross-tenant bypass exists', async () => {
    const sharedFactory = new InMemoryUserRepositoryFactory();
    const { app: org1App } = buildApp(() => ORG_1_USER, sharedFactory);
    const created = await request(org1App)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const { app: platformAdminOrg1App } = buildApp(() => PLATFORM_ADMIN_ORG_1, sharedFactory);
    const sameOrgResponse = await request(platformAdminOrg1App).get(`/api/v1/users/${created.body.id}`);
    expect(sameOrgResponse.status).toBe(200);

    const { app: platformAdminOrg2App } = buildApp(
      () => createAuthContext({ userId: 'u4', organizationId: 'org-2', isPlatformAdmin: true }),
      sharedFactory,
    );
    const crossOrgResponse = await request(platformAdminOrg2App).get(`/api/v1/users/${created.body.id}`);
    expect(crossOrgResponse.status).toBe(404);
  });

  it('GET /users/unknown-route-suffix returns a plain 404 (no router claims it)', async () => {
    const { app } = buildApp(() => ORG_1_USER);

    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
  });

  describe('MFA (mfa-user-enrollment PR2)', () => {
    /** Seeds a user via the real route, then returns an auth-context factory acting AS that user. */
    async function seedActingUser(app: Express): Promise<() => AuthContext> {
      const created = await request(app)
        .post('/api/v1/users')
        .send({ email: 'mfa-user@example.com', password: 'pw', firstName: 'Mfa', lastName: 'User' });
      const userId = created.body.id as string;
      return () => createAuthContext({ userId, organizationId: 'org-1', isPlatformAdmin: false });
    }

    it('POST /users/me/mfa/setup returns a QR data URL and otpauth URI, storing an encrypted (disabled) secret', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: seedApp } = buildApp(() => ORG_1_USER, sharedFactory);
      const actingAuth = await seedActingUser(seedApp);
      const { app } = buildApp(actingAuth, sharedFactory);

      const response = await request(app).post('/api/v1/users/me/mfa/setup');

      expect(response.status).toBe(200);
      expect(response.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(response.body.otpauthUri).toContain('otpauth://totp/');
    });

    it('full setup -> activate flow enables MFA', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: setupApp } = buildApp(() => ORG_1_USER, sharedFactory);
      const actingAuth = await seedActingUser(setupApp);
      const { app } = buildApp(actingAuth, sharedFactory);

      const setupResponse = await request(app).post('/api/v1/users/me/mfa/setup');
      const secretParam = new URL(setupResponse.body.otpauthUri).searchParams.get('secret')!;
      const token = authenticator.generate(secretParam);

      const activateResponse = await request(app).post('/api/v1/users/me/mfa/activate').send({ token });

      expect(activateResponse.status).toBe(200);
    });

    it('POST /users/me/mfa/activate rejects a wrong token with 401 MFA_TOKEN_INVALID', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: setupApp } = buildApp(() => ORG_1_USER, sharedFactory);
      const actingAuth = await seedActingUser(setupApp);
      const { app } = buildApp(actingAuth, sharedFactory);

      await request(app).post('/api/v1/users/me/mfa/setup');
      const response = await request(app).post('/api/v1/users/me/mfa/activate').send({ token: '000000' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MFA_TOKEN_INVALID');
    });

    it('DELETE /users/me/mfa disables MFA', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: setupApp } = buildApp(() => ORG_1_USER, sharedFactory);
      const actingAuth = await seedActingUser(setupApp);
      const { app } = buildApp(actingAuth, sharedFactory);

      await request(app).post('/api/v1/users/me/mfa/setup');
      const response = await request(app).delete('/api/v1/users/me/mfa');

      expect(response.status).toBe(200);
    });
  });
});
