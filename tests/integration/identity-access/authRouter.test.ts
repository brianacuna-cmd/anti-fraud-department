import { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { authRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import { createAuthenticateActorUseCase } from '../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import { createLogoutUseCase } from '../../../src/modules/identity-access/application/auth/Logout.js';
import { InMemoryActorCredentialGateway } from '../../helpers/identity-access/InMemoryActorCredentialGateway.js';
import { InMemorySessionRepository } from '../../helpers/identity-access/InMemorySessionRepository.js';
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { InMemoryAuditRecorder } from '../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../helpers/FixedClock.js';
import { Session } from '../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createPasswordCredential } from '../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { ActorCredentialRecord } from '../../../src/modules/identity-access/domain/ports/ActorCredentialGateway.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId('org-1');

const USER_RECORD: ActorCredentialRecord = {
  actorId: 'user-1',
  actorType: 'USER',
  organizationId: ORG_ID,
  credential: createPasswordCredential('hashed:correct-password'),
  lockout: { loginAttempts: 0, blockedUntil: null },
  status: 'ACTIVE',
  mfa: { enabled: false, secret: null },
};

const ORG_RECORD: ActorCredentialRecord = {
  actorId: 'org-1',
  actorType: 'ORGANIZATION',
  organizationId: null,
  credential: createPasswordCredential('hashed:org-password'),
  lockout: { loginAttempts: 0, blockedUntil: null },
  status: 'ACTIVE',
  mfa: { enabled: false, secret: null },
};

function buildApp(): {
  app: Express;
  userGateway: InMemoryActorCredentialGateway;
  organizationGateway: InMemoryActorCredentialGateway;
  sessions: InMemorySessionRepository;
} {
  const userGateway = new InMemoryActorCredentialGateway();
  const organizationGateway = new InMemoryActorCredentialGateway();
  const sessions = new InMemorySessionRepository();
  const passwordHasher = new FakePasswordHasher();
  const clock = new FixedClock(NOW);
  const dummyCredential = createPasswordCredential('hashed:dummy-password');
  const auditRecorder = new InMemoryAuditRecorder();

  const router = authRouter({
    authenticateUser: createAuthenticateActorUseCase({
      gateway: userGateway,
      passwordHasher,
      clock,
      dummyCredential,
      actorType: 'USER',
      auditRecorder,
    }),
    authenticateOrganization: createAuthenticateActorUseCase({
      gateway: organizationGateway,
      passwordHasher,
      clock,
      dummyCredential,
      actorType: 'ORGANIZATION',
      auditRecorder,
    }),
    logout: createLogoutUseCase({ sessions, clock, auditRecorder }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(
      req,
      createAuthContext({ userId: 'user-1', organizationId: 'org-1', sessionId: 'session-1' }),
    );
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(identityAccessErrorStatus),
  });

  return { app, userGateway, organizationGateway, sessions };
}

describe('authRouter (e2e, in-memory gateways)', () => {
  describe('POST /auth/users/login', () => {
    it('rejects a body with no organizationSlug (design D29 — required)', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ email: 'alice@example.com', password: 'correct-password' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('returns 200 AUTHENTICATED on correct credentials', async () => {
      const { app, userGateway } = buildApp();
      userGateway.seed('alice@example.com', USER_RECORD, 'acme');

      const response = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'AUTHENTICATED' });
    });

    it('an unknown email and a wrong password return the IDENTICAL 401 shape', async () => {
      const { app, userGateway } = buildApp();
      userGateway.seed('alice@example.com', USER_RECORD, 'acme');

      const unknownEmail = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'nobody@example.com', password: 'whatever' });
      const wrongPassword = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'wrong-password' });

      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('locks the account with 423 ACCOUNT_LOCKED on the 3rd consecutive failure', async () => {
      const { app, userGateway } = buildApp();
      userGateway.seed('alice@example.com', USER_RECORD, 'acme');

      await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'wrong-password' });
      await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'wrong-password' });
      const thirdAttempt = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'wrong-password' });

      expect(thirdAttempt.status).toBe(423);
      expect(thirdAttempt.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('a blocked account rejects with 423 even given the correct password', async () => {
      const { app, userGateway } = buildApp();
      userGateway.seed(
        'alice@example.com',
        { ...USER_RECORD, lockout: { loginAttempts: 3, blockedUntil: fromDate(new Date('2026-01-01T01:00:00.000Z')) } },
        'acme',
      );

      const response = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });

      expect(response.status).toBe(423);
      expect(response.body.error.code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('POST /auth/organizations/login', () => {
    it('does not require organizationSlug', async () => {
      const { app, organizationGateway } = buildApp();
      organizationGateway.seed('org@acme.example.com', ORG_RECORD);

      const response = await request(app)
        .post('/api/v1/auth/organizations/login')
        .send({ email: 'org@acme.example.com', password: 'org-password' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'AUTHENTICATED' });
    });

    it('rejects an unknown email with 401 INVALID_CREDENTIALS', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .post('/api/v1/auth/organizations/login')
        .send({ email: 'nobody@example.com', password: 'whatever' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the current session and returns 204', async () => {
      const { app, sessions } = buildApp();
      await sessions.save(
        Session.create({
          id: createSessionId('session-1'),
          userId: 'user-1',
          organizationId: ORG_ID,
          actorType: 'USER',
          tokenHash: 'token-hash-session-1',
          refreshTokenHash: 'refresh-hash-session-1',
          expiresAt: NOW,
          refreshExpiresAt: NOW,
          familyId: createFamilyId('family-1'),
          familyExpiresAt: NOW,
          now: NOW,
        }),
      );

      const response = await request(app).post('/api/v1/auth/logout').send({});

      expect(response.status).toBe(204);
      const revoked = await sessions.findByTokenHash('token-hash-session-1');
      expect(revoked?.deletedAt).toBe(NOW);
    });
  });
});
