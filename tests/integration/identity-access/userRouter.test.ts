import { oid } from '../../support/oid.js';
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
import { createChangePasswordUseCase } from '../../../src/modules/identity-access/application/ChangePassword.js';
import { createChangeUserRoleUseCase } from '../../../src/modules/identity-access/application/ChangeUserRole.js';
import { createSessionIssuer } from '../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { generateUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { OtplibTotpService } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { AesGcmSecretCipher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { InMemoryMfaChallengeStore } from '../../helpers/identity-access/InMemoryMfaChallengeStore.js';
import { InMemorySessionRepository } from '../../helpers/identity-access/InMemorySessionRepository.js';
import { SessionTokenAuthContextResolver } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/SessionTokenAuthContextResolver.js';
import { createAuthContextMiddleware } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/authContextMiddleware.js';
import { FakeQrCodeGenerator } from '../../helpers/identity-access/FakeQrCodeGenerator.js';
import { InMemoryRoleRepository } from '../../helpers/identity-access/InMemoryRoleRepository.js';
import { authenticator } from 'otplib';
import { fromDate } from '../../../src/shared/time/Instant.js';

// user-roles PR-1b: CreateUser is now org-only-gated (`requireOrganizationActor`).
// These drive every route in this file's tests (create/get/patch/transition/
// delete) — the other routes stay on `requireTenantContext` alone, so an
// ORGANIZATION actor works for them unchanged (design "7. `requireOrganizationActor`
// guard" — gates ONLY CreateUser and ChangeUserRole).
const ORG_1_ORGANIZATION = createAuthContext({ userId: oid('u1'), organizationId: oid('org-1'), actorType: 'ORGANIZATION' });
const ORG_2_ORGANIZATION = createAuthContext({ userId: oid('u2'), organizationId: oid('org-2'), actorType: 'ORGANIZATION' });
const PLATFORM_ADMIN_ORG_1 = createAuthContext({ userId: oid('u3'), organizationId: oid('org-1'), isPlatformAdmin: true });

const SECRET_CIPHER_FIXTURE = new AesGcmSecretCipher('test-secret', 1);
const TOKEN_SERVICE_FIXTURE = new AesGcmSessionTokenService(SECRET_CIPHER_FIXTURE);

function buildApp(
  actorPerRequest: () => AuthContext,
  userRepositoryFactory: InMemoryUserRepositoryFactory = new InMemoryUserRepositoryFactory(),
  mfaChallenges: InMemoryMfaChallengeStore = new InMemoryMfaChallengeStore(),
  sessions: InMemorySessionRepository = new InMemorySessionRepository(),
): { app: Express; userRepositoryFactory: InMemoryUserRepositoryFactory; mfaChallenges: InMemoryMfaChallengeStore; sessions: InMemorySessionRepository } {
  const unitOfWork = new InMemoryUnitOfWork();
  const passwordHasher = new FakePasswordHasher();
  const clock = new SystemClock();
  const auditRecorder = new InMemoryAuditRecorder();

  const transitionUserStatus = createTransitionUserStatusUseCase({
    userRepositoryFactory,
    sessions,
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
      roleRepository: new InMemoryRoleRepository(),
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
      secretCipher: SECRET_CIPHER_FIXTURE,
      auditRecorder,
      mfaChallenges,
      issueSessionFor: createSessionIssuer({
        sessionTokenService: TOKEN_SERVICE_FIXTURE,
        sessions,
        tokenKeyVersion: 1,
        ttls: { sessionSeconds: 900 },
      }),
    }),
    disableMfa: createDisableMfaUseCase({ userRepositoryFactory, unitOfWork, clock, auditRecorder }),
    changePassword: createChangePasswordUseCase({
      userRepositoryFactory,
      passwordHasher,
      sessions,
      unitOfWork,
      clock,
      auditRecorder,
    }),
    changeUserRole: createChangeUserRoleUseCase({
      userRepositoryFactory,
      roleRepository: new InMemoryRoleRepository(),
      unitOfWork,
      clock,
      auditRecorder,
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

  return { app, userRepositoryFactory, mfaChallenges, sessions };
}

/**
 * Builds the SAME `userRouter` but mounted behind the REAL
 * `SessionTokenAuthContextResolver` (not the test-only `attachAuthContext`
 * bypass) — needed to exercise an `mfa_enrollment` Bearer token end-to-end
 * (two-step-login PR3, design D5: "resolver -> scoped ctx").
 */
function buildAppWithRealResolver(
  userRepositoryFactory: InMemoryUserRepositoryFactory = new InMemoryUserRepositoryFactory(),
  mfaChallenges: InMemoryMfaChallengeStore = new InMemoryMfaChallengeStore(),
  sessions: InMemorySessionRepository = new InMemorySessionRepository(),
): { app: Express; userRepositoryFactory: InMemoryUserRepositoryFactory; mfaChallenges: InMemoryMfaChallengeStore; sessions: InMemorySessionRepository } {
  const unitOfWork = new InMemoryUnitOfWork();
  const passwordHasher = new FakePasswordHasher();
  const clock = new SystemClock();
  const auditRecorder = new InMemoryAuditRecorder();

  const transitionUserStatus = createTransitionUserStatusUseCase({ userRepositoryFactory, sessions, unitOfWork, clock, auditRecorder });

  const router = userRouter({
    createUser: createCreateUserUseCase({
      userRepositoryFactory,
      passwordHasher,
      unitOfWork,
      clock,
      generateId: generateUserId,
      auditRecorder,
      roleRepository: new InMemoryRoleRepository(),
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
      secretCipher: SECRET_CIPHER_FIXTURE,
      issuer: 'AntiFraud',
    }),
    activateMfa: createActivateMfaUseCase({
      userRepositoryFactory,
      unitOfWork,
      clock,
      totpService: new OtplibTotpService(),
      secretCipher: SECRET_CIPHER_FIXTURE,
      auditRecorder,
      mfaChallenges,
      issueSessionFor: createSessionIssuer({
        sessionTokenService: TOKEN_SERVICE_FIXTURE,
        sessions,
        tokenKeyVersion: 1,
        ttls: { sessionSeconds: 900 },
      }),
    }),
    disableMfa: createDisableMfaUseCase({ userRepositoryFactory, unitOfWork, clock, auditRecorder }),
    changePassword: createChangePasswordUseCase({
      userRepositoryFactory,
      passwordHasher,
      sessions,
      unitOfWork,
      clock,
      auditRecorder,
    }),
    changeUserRole: createChangeUserRoleUseCase({
      userRepositoryFactory,
      roleRepository: new InMemoryRoleRepository(),
      unitOfWork,
      clock,
      auditRecorder,
    }),
  });

  const resolver = new SessionTokenAuthContextResolver(TOKEN_SERVICE_FIXTURE, sessions, userRepositoryFactory);
  const authContextMiddleware = createAuthContextMiddleware(resolver);

  const mounted = Router();
  mounted.use(authContextMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(identityAccessErrorStatus),
  });

  return { app, userRepositoryFactory, mfaChallenges, sessions };
}

describe('userRouter (e2e, in-memory repository)', () => {
  it('POST /users creates a user scoped to the caller\'s organization', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);

    const response = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Sup3rSecret', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      email: 'alice@example.com',
      firstName: 'Alice',
      organizationId: oid('org-1'),
      status: 'ACTIVE',
      roleId: 'ANALYST',
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('POST /users rejects a USER-tier actor with 403 FORBIDDEN_ROLE (user-roles PR-1b org-only gate + role gate)', async () => {
    const actingUser = createAuthContext({ userId: oid('u9'), organizationId: oid('org-1'), isPlatformAdmin: false });
    const { app } = buildApp(() => actingUser);

    const response = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    expect(response.status).toBe(403);
    // This fork puts `requireUserRole` in front of the organization-only
    // gate, so a USER actor is rejected by role — a more specific 403 —
    // before reaching the tenant check.
    expect(response.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('POST /users rejects role=ADMIN with 400 ROLE_NOT_ASSIGNABLE (user-roles PR-1b)', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);

    const response = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ADMIN' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('POST /users rejects a missing role with 400 (zod validation)', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);

    const response = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith' });

    expect(response.status).toBe(400);
  });

  it('GET /users/:id returns 404 USER_NOT_FOUND for a cross-tenant id', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const { app: otherOrgApp } = buildApp(() => ORG_2_ORGANIZATION);
    const response = await request(otherOrgApp).get(`/api/v1/users/${created.body.id}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('GET /users paginates within the caller\'s organization', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    await request(app).post('/api/v1/users').send({ email: 'a@example.com', password: 'Passw0rd1', firstName: 'A', lastName: 'S', role: 'ANALYST' });
    await request(app).post('/api/v1/users').send({ email: 'b@example.com', password: 'Passw0rd1', firstName: 'B', lastName: 'T', role: 'ANALYST' });

    const firstPage = await request(app).get('/api/v1/users?limit=1');

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).not.toBeNull();
  });

  it('PATCH /users/:id updates firstName/lastName/email/avatarUrl only', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const response = await request(app)
      .patch(`/api/v1/users/${created.body.id}`)
      .send({ firstName: 'Alicia' });

    expect(response.status).toBe(200);
    expect(response.body.firstName).toBe('Alicia');
  });

  it('PATCH /users/:id rejects an attempt to set roleIds with 400 INVARIANT_VIOLATION', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const response = await request(app)
      .patch(`/api/v1/users/${created.body.id}`)
      .send({ roleIds: ['role-1'] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('POST /users/:id/transition changes status on a valid transition', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'SUSPENDED' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('SUSPENDED');
  });

  it('POST /users/:id/transition rejects an invalid transition with 422', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'ACTIVE' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('POST /users/:id/role changes a user\'s role (user-roles PR-2)', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/role`)
      .send({ role: 'SUPERVISOR' });

    expect(response.status).toBe(200);
    expect(response.body.roleId).toBe('SUPERVISOR');
  });

  it('POST /users/:id/role rejects a USER-tier actor with 403 FORBIDDEN_ROLE (user-roles PR-2 + role gate)', async () => {
    const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(seedApp)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const actingUser = createAuthContext({ userId: oid('u9'), organizationId: oid('org-1'), isPlatformAdmin: false });
    const { app } = buildApp(() => actingUser);

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/role`)
      .send({ role: 'SUPERVISOR' });

    expect(response.status).toBe(403);
    // This fork puts `requireUserRole` in front of the organization-only
    // gate, so a USER actor is rejected by role — a more specific 403 —
    // before reaching the tenant check.
    expect(response.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('POST /users/:id/role returns 404 USER_NOT_FOUND for an unknown user', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);

    const response = await request(app)
      .post(`/api/v1/users/${oid('unknown-id')}/role`)
      .send({ role: 'SUPERVISOR' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('POST /users/:id/role returns 404 USER_NOT_FOUND for a cross-tenant user', async () => {
    const sharedFactory = new InMemoryUserRepositoryFactory();
    const { app: org1App } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
    const created = await request(org1App)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const { app: org2App } = buildApp(() => ORG_2_ORGANIZATION, sharedFactory);
    const response = await request(org2App)
      .post(`/api/v1/users/${created.body.id}/role`)
      .send({ role: 'SUPERVISOR' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('an org-admin cannot reactivate a DISABLED user in their own org (FORBIDDEN_REACTIVATION)', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });
    await request(app).delete(`/api/v1/users/${created.body.id}`);

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'ACTIVE' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_REACTIVATION');
  });

  it('DELETE /users/:id behaves identically to transition to DISABLED', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const response = await request(app).delete(`/api/v1/users/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DISABLED');
  });

  it('a platform-admin shares the ordinary tenant-scoped path — no special cross-tenant bypass exists', async () => {
    const sharedFactory = new InMemoryUserRepositoryFactory();
    const { app: org1App } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
    const created = await request(org1App)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'Passw0rd1', firstName: 'Alice', lastName: 'Smith', role: 'ANALYST' });

    const { app: platformAdminOrg1App } = buildApp(() => PLATFORM_ADMIN_ORG_1, sharedFactory);
    const sameOrgResponse = await request(platformAdminOrg1App).get(`/api/v1/users/${created.body.id}`);
    expect(sameOrgResponse.status).toBe(200);

    const { app: platformAdminOrg2App } = buildApp(
      () => createAuthContext({ userId: oid('u4'), organizationId: oid('org-2'), isPlatformAdmin: true }),
      sharedFactory,
    );
    const crossOrgResponse = await request(platformAdminOrg2App).get(`/api/v1/users/${created.body.id}`);
    expect(crossOrgResponse.status).toBe(404);
  });

  it('GET /users/unknown-route-suffix returns a plain 404 (no router claims it)', async () => {
    const { app } = buildApp(() => ORG_1_ORGANIZATION);

    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
  });

  describe('MFA (mfa-user-enrollment PR2)', () => {
    /** Seeds a user via the real route, then returns an auth-context factory acting AS that user. */
    async function seedActingUser(app: Express): Promise<() => AuthContext> {
      const created = await request(app)
        .post('/api/v1/users')
        .send({ email: 'mfa-user@example.com', password: 'Passw0rd1', firstName: 'Mfa', lastName: 'User', role: 'ANALYST' });
      const userId = created.body.id as string;
      return () => createAuthContext({ userId, organizationId: oid('org-1'), isPlatformAdmin: false });
    }

    it('POST /users/me/mfa/setup returns a QR data URL and otpauth URI, storing an encrypted (disabled) secret', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
      const actingAuth = await seedActingUser(seedApp);
      const { app } = buildApp(actingAuth, sharedFactory);

      const response = await request(app).post('/api/v1/users/me/mfa/setup');

      expect(response.status).toBe(200);
      expect(response.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(response.body.otpauthUri).toContain('otpauth://totp/');
    });

    it('full setup -> activate flow enables MFA', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: setupApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
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
      const { app: setupApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
      const actingAuth = await seedActingUser(setupApp);
      const { app } = buildApp(actingAuth, sharedFactory);

      await request(app).post('/api/v1/users/me/mfa/setup');
      const response = await request(app).post('/api/v1/users/me/mfa/activate').send({ token: '000000' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MFA_TOKEN_INVALID');
    });

    it('DELETE /users/me/mfa disables MFA', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: setupApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
      const actingAuth = await seedActingUser(setupApp);
      const { app } = buildApp(actingAuth, sharedFactory);

      await request(app).post('/api/v1/users/me/mfa/setup');
      const response = await request(app).delete('/api/v1/users/me/mfa');

      expect(response.status).toBe(200);
    });
  });

  describe('Change Password (password-management PR-1)', () => {
    async function seedActingUser(app: Express, password: string): Promise<() => AuthContext> {
      const created = await request(app)
        .post('/api/v1/users')
        .send({ email: 'pw-user@example.com', password, firstName: 'Pw', lastName: 'User', role: 'ANALYST' });
      const userId = created.body.id as string;
      return () => createAuthContext({ userId, organizationId: oid('org-1'), isPlatformAdmin: false });
    }

    it('POST /users/me/password replaces the credential and returns 204 on correct current password', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
      const actingAuth = await seedActingUser(seedApp, 'OldPassw0rd');
      const { app } = buildApp(actingAuth, sharedFactory);

      const response = await request(app)
        .post('/api/v1/users/me/password')
        .send({ currentPassword: 'OldPassw0rd', newPassword: 'NewPassw0rd' });

      expect(response.status).toBe(204);
    });

    it('POST /users/me/password rejects a wrong current password with 401 INVALID_CREDENTIALS', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
      const actingAuth = await seedActingUser(seedApp, 'OldPassw0rd');
      const { app } = buildApp(actingAuth, sharedFactory);

      const response = await request(app)
        .post('/api/v1/users/me/password')
        .send({ currentPassword: 'wrong-password', newPassword: 'NewPassw0rd' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('POST /users/me/password requires authentication (no resolved AuthContext — 401, same as every other route)', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory);
      const mfaChallenges = new InMemoryMfaChallengeStore();
      const sessions = new InMemorySessionRepository();
      await seedActingUser(seedApp, 'OldPassw0rd');
      const { app } = buildAppWithRealResolver(sharedFactory, mfaChallenges, sessions);

      const response = await request(app)
        .post('/api/v1/users/me/password')
        .send({ currentPassword: 'OldPassw0rd', newPassword: 'NewPassw0rd' });

      // `requireAuthContext` throws `UnauthenticatedError`: with a real
      // session resolver, a missing/expired/revoked token leaves the request
      // without context and that is a 401, not a wiring failure.
      expect(response.status).toBe(401);
    });
  });

  describe('Forced enrollment + scoped authorization (two-step-login PR3, tasks 3.1/3.3/3.4/3.5)', () => {
    function issueEnrollmentToken(userId: string, jti: string, expiresAt = '2099-01-01T00:00:00.000Z'): string {
      return TOKEN_SERVICE_FIXTURE.issue({
        tokenType: 'mfa_enrollment',
        keyVersion: 1,
        jti,
        userId,
        organizationId: oid('org-1'),
        actorType: 'USER',
        expiresAt,
      });
    }

    async function appendEnrollment(
      mfaChallenges: InMemoryMfaChallengeStore,
      userId: string,
      jti: string,
      expiresAt = fromDate(new Date('2099-01-01T00:00:00.000Z')),
    ): Promise<void> {
      await mfaChallenges.append({
        jti,
        userId,
        organizationId: oid('org-1'),
        actorType: 'USER',
        tokenType: 'mfa_enrollment',
        expiresAt,
        now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
      });
    }

    it('enrollment token -> setup -> activate (correct TOTP) -> full ACCESS+REFRESH session (task 3.3)', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const mfaChallenges = new InMemoryMfaChallengeStore();
      const sessions = new InMemorySessionRepository();
      const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory, mfaChallenges, sessions);
      const created = await request(seedApp)
        .post('/api/v1/users')
        .send({ email: 'enrollee@example.com', password: 'Passw0rd1', firstName: 'En', lastName: 'Rollee', role: 'ANALYST' });
      const userId = created.body.id as string;

      const { app } = buildAppWithRealResolver(sharedFactory, mfaChallenges, sessions);
      await appendEnrollment(mfaChallenges, userId, 'jti-enroll-1');
      const enrollmentToken = issueEnrollmentToken(userId, 'jti-enroll-1');

      const setupResponse = await request(app)
        .post('/api/v1/users/me/mfa/setup')
        .set('Authorization', `Bearer ${enrollmentToken}`);
      expect(setupResponse.status).toBe(200);
      const secretParam = new URL(setupResponse.body.otpauthUri).searchParams.get('secret')!;
      const totp = authenticator.generate(secretParam);

      const activateResponse = await request(app)
        .post('/api/v1/users/me/mfa/activate')
        .set('Authorization', `Bearer ${enrollmentToken}`)
        .send({ token: totp });

      expect(activateResponse.status).toBe(200);
      expect(activateResponse.body.session).not.toBeNull();
      expect(typeof activateResponse.body.session.accessToken).toBe('string');
      expect(typeof activateResponse.body.session.refreshToken).toBe('string');
      expect(activateResponse.body.user.id).toBe(userId);
    });

    it('rejects an mfa_enrollment token on any non-setup/activate route with 403 FORBIDDEN_AUTH_SCOPE (task 3.4)', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const mfaChallenges = new InMemoryMfaChallengeStore();
      const sessions = new InMemorySessionRepository();
      const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory, mfaChallenges, sessions);
      const created = await request(seedApp)
        .post('/api/v1/users')
        .send({ email: 'enrollee2@example.com', password: 'Passw0rd1', firstName: 'En', lastName: 'Rollee', role: 'ANALYST' });
      const userId = created.body.id as string;

      const { app } = buildAppWithRealResolver(sharedFactory, mfaChallenges, sessions);
      await appendEnrollment(mfaChallenges, userId, 'jti-enroll-2');
      const enrollmentToken = issueEnrollmentToken(userId, 'jti-enroll-2');

      const listResponse = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${enrollmentToken}`);
      expect(listResponse.status).toBe(403);
      expect(listResponse.body.error.code).toBe('FORBIDDEN_AUTH_SCOPE');

      const getResponse = await request(app)
        .get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${enrollmentToken}`);
      expect(getResponse.status).toBe(403);
      expect(getResponse.body.error.code).toBe('FORBIDDEN_AUTH_SCOPE');

      const disableResponse = await request(app)
        .delete('/api/v1/users/me/mfa')
        .set('Authorization', `Bearer ${enrollmentToken}`);
      expect(disableResponse.status).toBe(403);
      expect(disableResponse.body.error.code).toBe('FORBIDDEN_AUTH_SCOPE');
    });

    it('rejects a replayed enrollment token — activation already consumed, second activate fails (task 3.5)', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const mfaChallenges = new InMemoryMfaChallengeStore();
      const sessions = new InMemorySessionRepository();
      const { app: seedApp } = buildApp(() => ORG_1_ORGANIZATION, sharedFactory, mfaChallenges, sessions);
      const created = await request(seedApp)
        .post('/api/v1/users')
        .send({ email: 'enrollee3@example.com', password: 'Passw0rd1', firstName: 'En', lastName: 'Rollee', role: 'ANALYST' });
      const userId = created.body.id as string;

      const { app } = buildAppWithRealResolver(sharedFactory, mfaChallenges, sessions);
      await appendEnrollment(mfaChallenges, userId, 'jti-enroll-3');
      const enrollmentToken = issueEnrollmentToken(userId, 'jti-enroll-3');

      const setupResponse = await request(app)
        .post('/api/v1/users/me/mfa/setup')
        .set('Authorization', `Bearer ${enrollmentToken}`);
      const secretParam = new URL(setupResponse.body.otpauthUri).searchParams.get('secret')!;
      const totp = authenticator.generate(secretParam);

      const firstActivate = await request(app)
        .post('/api/v1/users/me/mfa/activate')
        .set('Authorization', `Bearer ${enrollmentToken}`)
        .send({ token: totp });
      expect(firstActivate.status).toBe(200);

      const replayTotp = authenticator.generate(secretParam);
      const replayedActivate = await request(app)
        .post('/api/v1/users/me/mfa/activate')
        .set('Authorization', `Bearer ${enrollmentToken}`)
        .send({ token: replayTotp });

      expect(replayedActivate.status).toBe(409);
      expect(replayedActivate.body.error.code).toBe('MFA_ENROLLMENT_NOT_PENDING');
    });

    it('rejects an expired enrollment token before it ever reaches the route handler', async () => {
      const sharedFactory = new InMemoryUserRepositoryFactory();
      const mfaChallenges = new InMemoryMfaChallengeStore();
      const sessions = new InMemorySessionRepository();
      const { app } = buildAppWithRealResolver(sharedFactory, mfaChallenges, sessions);
      const expiredToken = issueEnrollmentToken(oid('user-x'), 'jti-expired', '2020-01-01T00:00:00.000Z');

      const response = await request(app)
        .post('/api/v1/users/me/mfa/setup')
        .set('Authorization', `Bearer ${expiredToken}`);

      // No AuthContext was ever attached (self-expired token resolves to
      // null) — `requireScopedAuthContext` throws the wiring error, which
      // Express 5 forwards to the generic error handler.
      // `requireAuthContext` throws `UnauthenticatedError`: with a real
      // session resolver, a missing/expired/revoked token leaves the request
      // without context and that is a 401, not a wiring failure.
      expect(response.status).toBe(401);
    });
  });
});
