import { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { authRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import { createAuthenticateActorUseCase } from '../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import { createBeginUserLoginUseCase } from '../../../src/modules/identity-access/application/auth/BeginUserLogin.js';
import { createIssueSessionUseCase } from '../../../src/modules/identity-access/application/auth/IssueSession.js';
import { createSessionIssuer } from '../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { createLogoutUseCase } from '../../../src/modules/identity-access/application/auth/Logout.js';
import { InMemoryActorCredentialGateway } from '../../helpers/identity-access/InMemoryActorCredentialGateway.js';
import { InMemorySessionRepository } from '../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUserRepositoryFactory } from '../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryMfaChallengeStore } from '../../helpers/identity-access/InMemoryMfaChallengeStore.js';
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { InMemoryAuditRecorder } from '../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../helpers/FixedClock.js';
import { AesGcmSessionTokenService } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { OtplibTotpService } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
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

const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOTP_SERVICE = new OtplibTotpService();
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);

function buildApp(): {
  app: Express;
  userGateway: InMemoryActorCredentialGateway;
  organizationGateway: InMemoryActorCredentialGateway;
  sessions: InMemorySessionRepository;
  userRepositoryFactory: InMemoryUserRepositoryFactory;
  mfaChallenges: InMemoryMfaChallengeStore;
} {
  const userGateway = new InMemoryActorCredentialGateway();
  const organizationGateway = new InMemoryActorCredentialGateway();
  const sessions = new InMemorySessionRepository();
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const mfaChallenges = new InMemoryMfaChallengeStore();
  const passwordHasher = new FakePasswordHasher();
  const clock = new FixedClock(NOW);
  const dummyCredential = createPasswordCredential('hashed:dummy-password');
  const auditRecorder = new InMemoryAuditRecorder();

  const authenticateUser = createAuthenticateActorUseCase({
    gateway: userGateway,
    passwordHasher,
    clock,
    dummyCredential,
    actorType: 'USER',
    auditRecorder,
  });
  const sessionIssuer = createSessionIssuer({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    tokenKeyVersion: 1,
    ttls: { sessionSeconds: 900, refreshSeconds: 1_209_600, familySeconds: 2_592_000 },
  });

  const router = authRouter({
    beginUserLogin: createBeginUserLoginUseCase({
      authenticateActor: authenticateUser,
      sessionTokenService: TOKEN_SERVICE,
      mfaChallenges,
      clock,
      tokenKeyVersion: 1,
      challengeTtlSeconds: 300,
      enrollmentTtlSeconds: 900,
    }),
    authenticateOrganization: createAuthenticateActorUseCase({
      gateway: organizationGateway,
      passwordHasher,
      clock,
      dummyCredential,
      actorType: 'ORGANIZATION',
      auditRecorder,
    }),
    issueSession: createIssueSessionUseCase({
      sessionTokenService: TOKEN_SERVICE,
      mfaChallenges,
      userRepositoryFactory,
      totpService: TOTP_SERVICE,
      secretCipher: SECRET_CIPHER,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      issueSessionFor: sessionIssuer,
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

  return { app, userGateway, organizationGateway, sessions, userRepositoryFactory, mfaChallenges };
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

    it('returns an mfa_enrollment token (not a session) when mfa.enabled=false', async () => {
      const { app, userGateway } = buildApp();
      userGateway.seed('alice@example.com', USER_RECORD, 'acme');

      const response = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('MFA_ENROLLMENT_REQUIRED');
      expect(typeof response.body.enrollmentToken).toBe('string');
    });

    it('returns an mfa_challenge token (not a session) when mfa.enabled=true', async () => {
      const { app, userGateway } = buildApp();
      userGateway.seed('alice@example.com', { ...USER_RECORD, mfa: { enabled: true, secret: 'enc' } }, 'acme');

      const response = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('MFA_CHALLENGE_REQUIRED');
      expect(typeof response.body.challengeToken).toBe('string');
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

  describe('POST /auth/users/mfa (challenge path, two-step-login PR2)', () => {
    async function seedActivatedUser(
      userRepositoryFactory: InMemoryUserRepositoryFactory,
      plaintextSecret: string,
    ): Promise<void> {
      const user = User.create({
        id: createUserId('user-1'),
        organizationId: ORG_ID,
        email: createEmail('alice@example.com'),
        credential: createPasswordCredential('hash'),
        firstName: 'Alice',
        lastName: 'Smith',
        now: NOW,
      })
        .startMfaEnrollment(SECRET_CIPHER.encrypt(plaintextSecret), NOW)
        .confirmMfaEnrollment(NOW);
      await userRepositoryFactory.forTenant(ORG_ID).save(user);
    }

    it('login -> mfa with a valid TOTP issues ACCESS+REFRESH tokens (e2e, task 2.6)', async () => {
      const { app, userGateway, userRepositoryFactory } = buildApp();
      const plaintextSecret = TOTP_SERVICE.generateSecret();
      userGateway.seed('alice@example.com', { ...USER_RECORD, mfa: { enabled: true, secret: SECRET_CIPHER.encrypt(plaintextSecret) } }, 'acme');
      await seedActivatedUser(userRepositoryFactory, plaintextSecret);

      const loginResponse = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });
      expect(loginResponse.body.status).toBe('MFA_CHALLENGE_REQUIRED');

      const { authenticator } = await import('otplib');
      const totp = authenticator.generate(plaintextSecret);
      const mfaResponse = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken: loginResponse.body.challengeToken, totp });

      expect(mfaResponse.status).toBe(200);
      expect(typeof mfaResponse.body.accessToken).toBe('string');
      expect(typeof mfaResponse.body.refreshToken).toBe('string');
    });

    it('rejects wrong TOTP, expired, replayed, and unknown-jti challenge tokens (task 2.7)', async () => {
      const { app, userGateway, userRepositoryFactory, mfaChallenges } = buildApp();
      const plaintextSecret = TOTP_SERVICE.generateSecret();
      userGateway.seed('alice@example.com', { ...USER_RECORD, mfa: { enabled: true, secret: SECRET_CIPHER.encrypt(plaintextSecret) } }, 'acme');
      await seedActivatedUser(userRepositoryFactory, plaintextSecret);

      const loginResponse = await request(app)
        .post('/api/v1/auth/users/login')
        .send({ organizationSlug: 'acme', email: 'alice@example.com', password: 'correct-password' });
      const challengeToken = loginResponse.body.challengeToken as string;

      // Wrong TOTP: rejected, jti still unconsumed.
      const wrongTotp = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken, totp: '000000' });
      expect(wrongTotp.status).toBe(401);
      expect(wrongTotp.body.error.code).toBe('MFA_TOKEN_INVALID');

      // Unknown jti: a syntactically valid but never-appended challenge token.
      const unknownJtiToken = TOKEN_SERVICE.issue({
        tokenType: 'mfa_challenge',
        keyVersion: 1,
        jti: 'never-appended',
        userId: 'user-1',
        organizationId: 'org-1',
        actorType: 'USER',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
      const { authenticator } = await import('otplib');
      const totp = authenticator.generate(plaintextSecret);
      const unknownJti = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken: unknownJtiToken, totp });
      expect(unknownJti.status).toBe(401);
      expect(unknownJti.body.error.code).toBe('MFA_CHALLENGE_INVALID');

      // Expired token: self-expiry check rejects before any store lookup.
      const expiredToken = TOKEN_SERVICE.issue({
        tokenType: 'mfa_challenge',
        keyVersion: 1,
        jti: 'expired-jti',
        userId: 'user-1',
        organizationId: 'org-1',
        actorType: 'USER',
        expiresAt: '2020-01-01T00:00:00.000Z',
      });
      const expired = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken: expiredToken, totp });
      expect(expired.status).toBe(401);
      expect(expired.body.error.code).toBe('MFA_CHALLENGE_INVALID');

      // Replay: the valid token succeeds once, then is rejected on reuse.
      const firstUse = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken, totp });
      expect(firstUse.status).toBe(200);

      const replayTotp = authenticator.generate(plaintextSecret);
      const replay = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken, totp: replayTotp });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('MFA_CHALLENGE_INVALID');
      expect(mfaChallenges).toBeDefined();
    });

    it('rejects an ACCESS-typed (or otherwise malformed) token at /mfa', async () => {
      const { app } = buildApp();
      const accessToken = TOKEN_SERVICE.issue({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });

      const response = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken: accessToken, totp: '123456' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MFA_CHALLENGE_INVALID');
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
