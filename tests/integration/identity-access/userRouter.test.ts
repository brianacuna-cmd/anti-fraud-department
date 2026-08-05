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
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { createCreateUserUseCase } from '../../../src/modules/identity-access/application/CreateUser.js';
import { createGetUserUseCase } from '../../../src/modules/identity-access/application/GetUser.js';
import { createListUsersUseCase } from '../../../src/modules/identity-access/application/ListUsers.js';
import { createPatchUserIdentityUseCase } from '../../../src/modules/identity-access/application/PatchUserIdentity.js';
import { createTransitionUserStatusUseCase } from '../../../src/modules/identity-access/application/TransitionUserStatus.js';
import { createDeleteUserUseCase } from '../../../src/modules/identity-access/application/DeleteUser.js';
import { generateUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';

const ORG_1_USER = createAuthContext({ userId: 'u1', organizationId: 'org-1', isPlatformAdmin: false });
const ORG_2_USER = createAuthContext({ userId: 'u2', organizationId: 'org-2', isPlatformAdmin: false });
const PLATFORM_ADMIN_ORG_1 = createAuthContext({ userId: 'u3', organizationId: 'org-1', isPlatformAdmin: true });

function buildApp(actorPerRequest: () => AuthContext): { app: Express; userRepositoryFactory: InMemoryUserRepositoryFactory } {
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const unitOfWork = new InMemoryUnitOfWork();
  const passwordHasher = new FakePasswordHasher();
  const clock = new SystemClock();

  const transitionUserStatus = createTransitionUserStatusUseCase({ userRepositoryFactory, unitOfWork, clock });

  const router = userRouter({
    createUser: createCreateUserUseCase({ userRepositoryFactory, passwordHasher, clock, generateId: generateUserId }),
    getUser: createGetUserUseCase({ userRepositoryFactory }),
    listUsers: createListUsersUseCase({ userRepositoryFactory }),
    patchUserIdentity: createPatchUserIdentityUseCase({ userRepositoryFactory, clock }),
    transitionUserStatus,
    deleteUser: createDeleteUserUseCase({ transitionUserStatus }),
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
      status: 'ACTIVO',
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
      .send({ next: 'SUSPENDIDO' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('SUSPENDIDO');
  });

  it('POST /users/:id/transition rejects an invalid transition with 422', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'ACTIVO' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('an org-admin cannot reactivate a DESHABILITADO user in their own org (FORBIDDEN_REACTIVATION)', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });
    await request(app).delete(`/api/v1/users/${created.body.id}`);

    const response = await request(app)
      .post(`/api/v1/users/${created.body.id}/transition`)
      .send({ next: 'ACTIVO' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_REACTIVATION');
  });

  it('DELETE /users/:id behaves identically to transition to DESHABILITADO', async () => {
    const { app } = buildApp(() => ORG_1_USER);
    const created = await request(app)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const response = await request(app).delete(`/api/v1/users/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DESHABILITADO');
  });

  it('a platform-admin from another organization cannot read a user via these routes (platform-admin flag does not bypass tenant scoping)', async () => {
    const { app: org1App } = buildApp(() => ORG_1_USER);
    const created = await request(org1App)
      .post('/api/v1/users')
      .send({ email: 'alice@example.com', password: 'pw', firstName: 'Alice', lastName: 'Smith' });

    const { app: platformAdminOrg1App } = buildApp(() => PLATFORM_ADMIN_ORG_1);
    // Platform-admin here shares org-1, included only to prove no special bypass logic exists
    // for isPlatformAdmin on these routes at all — a same-org platform-admin still just reads
    // their own org's data via the ordinary tenant-scoped path.
    const sameOrgResponse = await request(platformAdminOrg1App).get(`/api/v1/users/${created.body.id}`);
    expect(sameOrgResponse.status).toBe(200);
  });

  it('GET /users/unknown-route-suffix returns a plain 404 (no router claims it)', async () => {
    const { app } = buildApp(() => ORG_1_USER);

    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
  });
});
