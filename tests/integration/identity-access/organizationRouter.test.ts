import { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { organizationRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/organizationRouter.js';
import { InMemoryOrganizationRepository } from '../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryUserRepositoryFactory } from '../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../helpers/identity-access/InMemoryUnitOfWork.js';
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { createGetOrganizationUseCase } from '../../../src/modules/identity-access/application/GetOrganization.js';
import { createListOrganizationsUseCase } from '../../../src/modules/identity-access/application/ListOrganizations.js';
import { createPatchOrganizationIdentityUseCase } from '../../../src/modules/identity-access/application/PatchOrganizationIdentity.js';
import { createTransitionOrganizationStatusUseCase } from '../../../src/modules/identity-access/application/TransitionOrganizationStatus.js';
import { createDeleteOrganizationUseCase } from '../../../src/modules/identity-access/application/DeleteOrganization.js';
import { createCreateOrganizationWithAdminUseCase } from '../../../src/modules/identity-access/application/CreateOrganizationWithAdmin.js';
import { generateOrganizationId, createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { generateUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';

const PLATFORM_ADMIN = createAuthContext({ userId: 'admin-1', organizationId: 'o0', isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: 'user-1', organizationId: 'o1', isPlatformAdmin: false });

const ADMIN_BOOTSTRAP_FIELDS = {
  adminEmail: 'admin@acme.com',
  adminPassword: 'super-secret',
  adminFirstName: 'Root',
  adminLastName: 'Admin',
};

function buildApp(actorPerRequest: () => AuthContext): {
  app: Express;
  organizations: InMemoryOrganizationRepository;
  userRepositoryFactory: InMemoryUserRepositoryFactory;
} {
  const organizations = new InMemoryOrganizationRepository();
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const unitOfWork = new InMemoryUnitOfWork();
  const passwordHasher = new FakePasswordHasher();
  const clock = new SystemClock();

  const transitionOrganizationStatus = createTransitionOrganizationStatusUseCase({
    organizations,
    unitOfWork,
    clock,
  });

  const router = organizationRouter({
    createOrganizationWithAdmin: createCreateOrganizationWithAdminUseCase({
      organizations,
      userRepositoryFactory,
      passwordHasher,
      unitOfWork,
      clock,
      generateOrganizationId,
      generateUserId,
    }),
    getOrganization: createGetOrganizationUseCase({ organizations }),
    listOrganizations: createListOrganizationsUseCase({ organizations }),
    patchOrganizationIdentity: createPatchOrganizationIdentityUseCase({ organizations, clock }),
    transitionOrganizationStatus,
    deleteOrganization: createDeleteOrganizationUseCase({ transitionOrganizationStatus }),
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

  return { app, organizations, userRepositoryFactory };
}

describe('organizationRouter (e2e, in-memory repository)', () => {
  it('POST /organizations atomically creates an organization AND its first admin user for a platform-admin', async () => {
    const { app, userRepositoryFactory } = buildApp(() => PLATFORM_ADMIN);

    const response = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme Corp', slug: 'acme-corp', ...ADMIN_BOOTSTRAP_FIELDS });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Acme Corp', slug: 'acme-corp', status: 'ACTIVO' });
    const adminUser = await userRepositoryFactory
      .forTenant(createOrganizationId(response.body.id))
      .findByEmail(createEmail('admin@acme.com'));
    expect(adminUser?.firstName).toBe('Root');
  });

  it('rejects a non-platform-admin on every organizations route with FORBIDDEN_CROSS_TENANT', async () => {
    const { app } = buildApp(() => REGULAR_USER);

    const response = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme Corp', slug: 'acme-corp', ...ADMIN_BOOTSTRAP_FIELDS });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('GET /organizations/:id returns 404 ORGANIZATION_NOT_FOUND for an unknown id', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);

    const response = await request(app).get('/api/v1/organizations/missing');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('GET /organizations paginates with a cursor', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);
    await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme', slug: 'acme', ...ADMIN_BOOTSTRAP_FIELDS, adminEmail: 'admin1@acme.com' });
    await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Globex', slug: 'globex', ...ADMIN_BOOTSTRAP_FIELDS, adminEmail: 'admin2@globex.com' });

    const firstPage = await request(app).get('/api/v1/organizations?limit=1');

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await request(app).get(`/api/v1/organizations?limit=1&cursor=${firstPage.body.nextCursor}`);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].slug).toBe('globex');
  });

  it('PATCH /organizations/:id updates name/logoUrl and leaves slug unchanged', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);
    const created = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme', slug: 'acme', ...ADMIN_BOOTSTRAP_FIELDS });

    const response = await request(app)
      .patch(`/api/v1/organizations/${created.body.id}`)
      .send({ name: 'Acme Corp Inc' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Acme Corp Inc');
    expect(response.body.slug).toBe('acme');
  });

  it('PATCH /organizations/:id rejects an attempt to change slug', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);
    const created = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme', slug: 'acme', ...ADMIN_BOOTSTRAP_FIELDS });

    const response = await request(app)
      .patch(`/api/v1/organizations/${created.body.id}`)
      .send({ slug: 'new-slug' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('POST /organizations/:id/transition changes status on a valid transition', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);
    const created = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme', slug: 'acme', ...ADMIN_BOOTSTRAP_FIELDS });

    const response = await request(app)
      .post(`/api/v1/organizations/${created.body.id}/transition`)
      .send({ next: 'SUSPENDIDO' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('SUSPENDIDO');
  });

  it('POST /organizations/:id/transition rejects an invalid transition with 422', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);
    const created = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme', slug: 'acme', ...ADMIN_BOOTSTRAP_FIELDS });

    const response = await request(app)
      .post(`/api/v1/organizations/${created.body.id}/transition`)
      .send({ next: 'ACTIVO' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('DELETE /organizations/:id behaves identically to transition to DESHABILITADO', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);
    const created = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Acme', slug: 'acme', ...ADMIN_BOOTSTRAP_FIELDS });

    const response = await request(app).delete(`/api/v1/organizations/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DESHABILITADO');
  });

  it('GET /organizations/unknown-route-suffix returns a plain 404 (no router claims it)', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);

    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
  });
});
