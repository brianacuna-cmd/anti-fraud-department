import { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { authRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import { createAuthenticateActorUseCase } from '../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import { createBeginUserLoginUseCase } from '../../../src/modules/identity-access/application/auth/BeginUserLogin.js';
import { createIssueSessionUseCase } from '../../../src/modules/identity-access/application/auth/IssueSession.js';
import { createIssueOrganizationSessionUseCase } from '../../../src/modules/identity-access/application/auth/IssueOrganizationSession.js';
import { createRefreshSessionUseCase } from '../../../src/modules/identity-access/application/auth/RefreshSession.js';
import { createSessionIssuer } from '../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { createLogoutUseCase } from '../../../src/modules/identity-access/application/auth/Logout.js';
import { createRequestPasswordResetUseCase } from '../../../src/modules/identity-access/application/auth/RequestPasswordReset.js';
import { createConfirmPasswordResetUseCase } from '../../../src/modules/identity-access/application/auth/ConfirmPasswordReset.js';
import { InMemoryActorCredentialGateway } from '../../helpers/identity-access/InMemoryActorCredentialGateway.js';
import { InMemorySessionRepository } from '../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUserRepositoryFactory } from '../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryOrganizationRepository } from '../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryUnitOfWork } from '../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryMfaChallengeStore } from '../../helpers/identity-access/InMemoryMfaChallengeStore.js';
import { FakePasswordHasher } from '../../helpers/identity-access/FakePasswordHasher.js';
import { InMemoryAuditRecorder } from '../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakeEmailSender } from '../../helpers/identity-access/FakeEmailSender.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createSlug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createRoleId } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
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
import { oid } from '../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId(oid('org-1'));

const USER_RECORD: ActorCredentialRecord = {
  actorId: oid('user-1'),
  actorType: 'USER',
  organizationId: ORG_ID,
  credential: createPasswordCredential('hashed:correct-password'),
  lockout: { loginAttempts: 0, blockedUntil: null },
  status: 'ACTIVE',
  mfa: { enabled: false, secret: null },
};

const ORG_RECORD: ActorCredentialRecord = {
  actorId: oid('org-1'),
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

function buildApp(
  authOverrides: Partial<Parameters<typeof createAuthContext>[0]> = {},
): {
  app: Express;
  userGateway: InMemoryActorCredentialGateway;
  organizationGateway: InMemoryActorCredentialGateway;
  sessions: InMemorySessionRepository;
  userRepositoryFactory: InMemoryUserRepositoryFactory;
  organizations: InMemoryOrganizationRepository;
  mfaChallenges: InMemoryMfaChallengeStore;
  emailSender: FakeEmailSender;
  auditRecorder: InMemoryAuditRecorder;
} {
  const userGateway = new InMemoryActorCredentialGateway();
  const organizationGateway = new InMemoryActorCredentialGateway();
  const sessions = new InMemorySessionRepository();
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const organizations = new InMemoryOrganizationRepository();
  const mfaChallenges = new InMemoryMfaChallengeStore();
  const passwordHasher = new FakePasswordHasher();
  const clock = new FixedClock(NOW);
  const dummyCredential = createPasswordCredential('hashed:dummy-password');
  const auditRecorder = new InMemoryAuditRecorder();
  const emailSender = new FakeEmailSender();

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
    // 3-step org login: el router genera el OTP y lo envía por aquí — el
    // FakeEmailSender lo captura para que los tests completen el flujo.
    emailSender,
    beginUserLogin: createBeginUserLoginUseCase({
      authenticateActor: authenticateUser,
      sessionTokenService: TOKEN_SERVICE,
      mfaChallenges,
      clock,
      tokenKeyVersion: 1,
      challengeTtlSeconds: 300,
      enrollmentTtlSeconds: 900,
    }),
    issueOrganizationSession: createIssueOrganizationSessionUseCase({
      authenticateActor: createAuthenticateActorUseCase({
        gateway: organizationGateway,
        passwordHasher,
        clock,
        dummyCredential,
        actorType: 'ORGANIZATION',
        auditRecorder,
      }),
      issueSessionFor: sessionIssuer,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
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
    refreshSession: createRefreshSessionUseCase({
      sessionTokenService: TOKEN_SERVICE,
      sessions,
      issueSessionFor: sessionIssuer,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      auditRecorder,
    }),
    logout: createLogoutUseCase({ sessions, clock, auditRecorder }),
    requestPasswordReset: createRequestPasswordResetUseCase({
      organizations,
      userRepositoryFactory,
      sessionTokenService: TOKEN_SERVICE,
      unitOfWork: new InMemoryUnitOfWork(),
      emailSender,
      auditRecorder,
      clock,
      tokenKeyVersion: 1,
      resetTtlSeconds: 900,
      emailFrom: 'fraud@backendstudio.tech',
      resetLinkBaseUrl: 'https://app.example.com/reset',
    }),
    confirmPasswordReset: createConfirmPasswordResetUseCase({
      sessionTokenService: TOKEN_SERVICE,
      userRepositoryFactory,
      passwordHasher,
      sessions,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      auditRecorder,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(
      req,
      createAuthContext({
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        sessionId: oid('session-1'),
        ...authOverrides,
      }),
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

  return { app, userGateway, organizationGateway, sessions, userRepositoryFactory, organizations, mfaChallenges, emailSender, auditRecorder };
}

/**
 * Completa los pasos 2 y 3 del login de organización de 3 pasos: extrae el
 * OTP del último email capturado por el FakeEmailSender, lo verifica (lo que
 * devuelve el secret TOTP de enrolamiento) y responde el challenge TOTP con
 * un código generado por otplib.
 */
async function completeOrgMfaSteps(app: Express, emailSender: FakeEmailSender, email: string) {
  const otpMail = emailSender.sent[emailSender.sent.length - 1]!;
  const otp = /(\d{6})/.exec(otpMail.text)![1]!;
  const verify = await request(app).post('/api/v1/auth/organizations/otp/verify').send({ email, otp });
  expect(verify.status).toBe(200);
  const totp = authenticator.generate(verify.body.secret as string);
  return request(app)
    .post('/api/v1/auth/organizations/mfa')
    .send({ challengeToken: verify.body.challengeToken, totp });
}

/** Login completo de organización (3 pasos) — devuelve la respuesta final con la sesión. */
async function orgLogin3Steps(app: Express, emailSender: FakeEmailSender, email: string, password: string) {
  await request(app).post('/api/v1/auth/organizations/login').send({ email, password });
  return completeOrgMfaSteps(app, emailSender, email);
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
        id: createUserId(oid('user-1')),
        organizationId: ORG_ID,
        email: createEmail('alice@example.com'),
        credential: createPasswordCredential('hash'),
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: createRoleId('ANALYST'),
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
        userId: oid('user-1'),
        organizationId: oid('org-1'),
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
        userId: oid('user-1'),
        organizationId: oid('org-1'),
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
      const accessToken = TOKEN_SERVICE.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });

      const response = await request(app)
        .post('/api/v1/auth/users/mfa')
        .send({ challengeToken: accessToken, totp: '123456' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MFA_CHALLENGE_INVALID');
    });
  });

  describe('POST /auth/organizations/login (3 pasos: credenciales -> OTP email -> TOTP)', () => {
    it('completes the 3-step flow and mints an ACCESS+REFRESH session at the final MFA step', async () => {
      const { app, organizationGateway, sessions, emailSender } = buildApp();
      organizationGateway.seed('org@acme.example.com', ORG_RECORD);

      const login = await request(app)
        .post('/api/v1/auth/organizations/login')
        .send({ email: 'org@acme.example.com', password: 'org-password' });
      expect(login.status).toBe(200);
      expect(login.body.status).toBe('OTP_REQUIRED');

      const response = await completeOrgMfaSteps(app, emailSender, 'org@acme.example.com');

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      const saved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(response.body.accessToken));
      expect(saved?.userId).toBeNull();
      expect(saved?.organizationId).toBe(ORG_ID);
      expect(saved?.actorType).toBe('ORGANIZATION');
    });

    it('rejects an unknown email with 401 INVALID_CREDENTIALS at the final MFA step (step 1 stays opaque OTP_REQUIRED)', async () => {
      const { app, emailSender } = buildApp();

      const login = await request(app)
        .post('/api/v1/auth/organizations/login')
        .send({ email: 'nobody@example.com', password: 'whatever' });
      expect(login.status).toBe(200);
      expect(login.body.status).toBe('OTP_REQUIRED');

      const response = await completeOrgMfaSteps(app, emailSender, 'nobody@example.com');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects a wrong email OTP with 401', async () => {
      const { app, organizationGateway } = buildApp();
      organizationGateway.seed('org@acme.example.com', ORG_RECORD);
      await request(app)
        .post('/api/v1/auth/organizations/login')
        .send({ email: 'org@acme.example.com', password: 'org-password' });

      const verify = await request(app)
        .post('/api/v1/auth/organizations/otp/verify')
        .send({ email: 'org@acme.example.com', otp: '000000' });

      expect(verify.status).toBe(401);
    });
  });

  describe('POST /auth/refresh (session-lifecycle PR-2)', () => {
    it('rotates a fresh refresh token: new ACCESS+REFRESH pair, old REFRESH token rejected at /auth/refresh (old ACCESS-token invalidation is covered by the resolver contract test)', async () => {
      const { app, organizationGateway, emailSender } = buildApp();
      organizationGateway.seed('org@acme.example.com', ORG_RECORD);
      const loginResponse = await orgLogin3Steps(app, emailSender, 'org@acme.example.com', 'org-password');

      const refreshResponse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginResponse.body.refreshToken });

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.accessToken).toEqual(expect.any(String));
      expect(refreshResponse.body.refreshToken).toEqual(expect.any(String));
      expect(refreshResponse.body.refreshToken).not.toBe(loginResponse.body.refreshToken);

      const replay = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginResponse.body.refreshToken });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('SESSION_INVALID');
    });

    it('rejects an unknown refresh token with 401 SESSION_INVALID (uniform opaque rejection)', async () => {
      const { app } = buildApp();

      const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('SESSION_INVALID');
    });

    it('rejects an ACCESS token presented at /auth/refresh with the SAME opaque 401', async () => {
      const { app, organizationGateway, emailSender } = buildApp();
      organizationGateway.seed('org@acme.example.com', ORG_RECORD);
      const loginResponse = await orgLogin3Steps(app, emailSender, 'org@acme.example.com', 'org-password');

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginResponse.body.accessToken });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('SESSION_INVALID');
    });

    it('rejects a body with no refreshToken with 400 INVARIANT_VIOLATION (DTO-level validation)', async () => {
      const { app } = buildApp();

      const response = await request(app).post('/api/v1/auth/refresh').send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('a reused (already-rotated) refresh token revokes the whole family, including the successor session', async () => {
      const { app, organizationGateway, emailSender } = buildApp();
      organizationGateway.seed('org@acme.example.com', ORG_RECORD);
      const loginResponse = await orgLogin3Steps(app, emailSender, 'org@acme.example.com', 'org-password');

      const rotated = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginResponse.body.refreshToken });
      expect(rotated.status).toBe(200);

      // Replay the original (already-rotated) refresh token -> reuse detected.
      const reuse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginResponse.body.refreshToken });
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('SESSION_INVALID');

      // The successor minted from the (now-burned) family must also be dead.
      const successorRefresh = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken });
      expect(successorRefresh.status).toBe(401);
      expect(successorRefresh.body.error.code).toBe('SESSION_INVALID');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the current session and returns 204', async () => {
      const { app, sessions } = buildApp();
      await sessions.save(
        Session.create({
          id: createSessionId(oid('session-1')),
          userId: oid('user-1'),
          organizationId: ORG_ID,
          actorType: 'USER',
          tokenHash: 'token-hash-session-1',
          refreshTokenHash: 'refresh-hash-session-1',
          expiresAt: NOW,
          refreshExpiresAt: NOW,
          familyId: createFamilyId(oid('family-1')),
          familyExpiresAt: NOW,
          now: NOW,
        }),
      );

      const response = await request(app).post('/api/v1/auth/logout').send({});

      expect(response.status).toBe(204);
      const revoked = await sessions.findByTokenHash('token-hash-session-1');
      expect(revoked?.deletedAt).toBe(NOW);
    });

    it('USER logout revokes only the current session, other sessions remain valid (regression)', async () => {
      const { app, sessions } = buildApp();
      await sessions.save(
        Session.create({
          id: createSessionId(oid('session-1')),
          userId: oid('user-1'),
          organizationId: ORG_ID,
          actorType: 'USER',
          tokenHash: 'token-hash-session-1',
          refreshTokenHash: 'refresh-hash-session-1',
          expiresAt: NOW,
          refreshExpiresAt: NOW,
          familyId: createFamilyId(oid('family-1')),
          familyExpiresAt: NOW,
          now: NOW,
        }),
      );
      await sessions.save(
        Session.create({
          id: createSessionId(oid('session-2')),
          userId: oid('user-1'),
          organizationId: ORG_ID,
          actorType: 'USER',
          tokenHash: 'token-hash-session-2',
          refreshTokenHash: 'refresh-hash-session-2',
          expiresAt: NOW,
          refreshExpiresAt: NOW,
          familyId: createFamilyId(oid('family-1')),
          familyExpiresAt: NOW,
          now: NOW,
        }),
      );

      const response = await request(app).post('/api/v1/auth/logout').send({});

      expect(response.status).toBe(204);
      const revoked = await sessions.findByTokenHash('token-hash-session-1');
      const other = await sessions.findByTokenHash('token-hash-session-2');
      expect(revoked?.deletedAt).toBe(NOW);
      expect(other?.deletedAt).toBeNull();
    });

    it('ORGANIZATION logout revokes ALL sessions for that organization (behavior change, session-lifecycle PR-1)', async () => {
      const { app, sessions } = buildApp({
        userId: oid('org-1'),
        organizationId: oid('org-1'),
        actorType: 'ORGANIZATION',
        sessionId: oid('org-session-1'),
      });
      await sessions.save(
        Session.create({
          id: createSessionId(oid('org-session-1')),
          userId: null,
          organizationId: ORG_ID,
          actorType: 'ORGANIZATION',
          tokenHash: 'token-hash-org-session-1',
          refreshTokenHash: 'refresh-hash-org-session-1',
          expiresAt: NOW,
          refreshExpiresAt: NOW,
          familyId: createFamilyId(oid('family-org-1')),
          familyExpiresAt: NOW,
          now: NOW,
        }),
      );
      await sessions.save(
        Session.create({
          id: createSessionId(oid('org-session-2')),
          userId: null,
          organizationId: ORG_ID,
          actorType: 'ORGANIZATION',
          tokenHash: 'token-hash-org-session-2',
          refreshTokenHash: 'refresh-hash-org-session-2',
          expiresAt: NOW,
          refreshExpiresAt: NOW,
          familyId: createFamilyId(oid('family-org-1')),
          familyExpiresAt: NOW,
          now: NOW,
        }),
      );

      const response = await request(app).post('/api/v1/auth/logout').send({});

      expect(response.status).toBe(204);
      const first = await sessions.findByTokenHash('token-hash-org-session-1');
      const second = await sessions.findByTokenHash('token-hash-org-session-2');
      expect(first?.deletedAt).toBe(NOW);
      expect(second?.deletedAt).toBe(NOW);
    });
  });

  describe('POST /auth/users/password-reset/request (password-management PR-2b)', () => {
    async function seedOrgAndUser(
      organizations: InMemoryOrganizationRepository,
      userRepositoryFactory: InMemoryUserRepositoryFactory,
    ): Promise<void> {
      const organization = Organization.create({ id: ORG_ID, slug: createSlug('acme'), name: 'Acme', now: NOW });
      await organizations.save(organization);

      const user = User.create({
        id: createUserId(oid('user-1')),
        organizationId: ORG_ID,
        email: createEmail('alice@example.com'),
        credential: createPasswordCredential('hash'),
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: createRoleId('ANALYST'),
        now: NOW,
      });
      await userRepositoryFactory.forTenant(ORG_ID).save(user);
    }

    it('the SAME opaque 200 body is returned for a matching user and for an unknown email', async () => {
      const { app, organizations, userRepositoryFactory, emailSender, auditRecorder } = buildApp();
      await seedOrgAndUser(organizations, userRepositoryFactory);

      const matching = await request(app)
        .post('/api/v1/auth/users/password-reset/request')
        .send({ organizationSlug: 'acme', email: 'alice@example.com' });
      const unknown = await request(app)
        .post('/api/v1/auth/users/password-reset/request')
        .send({ organizationSlug: 'acme', email: 'nobody@example.com' });

      expect(matching.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(matching.body).toEqual(unknown.body);
      expect(matching.body).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });

      // But only the matching user actually got a token/email/audit event.
      expect(emailSender.sent).toHaveLength(1);
      expect(auditRecorder.calls()).toHaveLength(1);
    });

    it('the SAME opaque 200 body is returned when organizationSlug is missing or unknown', async () => {
      const { app, organizations, userRepositoryFactory } = buildApp();
      await seedOrgAndUser(organizations, userRepositoryFactory);

      const missingSlug = await request(app)
        .post('/api/v1/auth/users/password-reset/request')
        .send({ email: 'alice@example.com' });
      const unknownSlug = await request(app)
        .post('/api/v1/auth/users/password-reset/request')
        .send({ organizationSlug: 'no-such-org', email: 'alice@example.com' });

      expect(missingSlug.status).toBe(200);
      expect(unknownSlug.status).toBe(200);
      expect(missingSlug.body).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
      expect(unknownSlug.body).toEqual({ status: 'PASSWORD_RESET_REQUESTED' });
    });

    it('rejects a body with no email with 400 INVARIANT_VIOLATION (DTO-level validation, not user-scoped)', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .post('/api/v1/auth/users/password-reset/request')
        .send({ organizationSlug: 'acme' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });
  });

  describe('POST /auth/users/password-reset/confirm (password-management PR-2c)', () => {
    async function seedOrgAndUserWithPendingReset(
      organizations: InMemoryOrganizationRepository,
      userRepositoryFactory: InMemoryUserRepositoryFactory,
    ): Promise<string> {
      const organization = Organization.create({ id: ORG_ID, slug: createSlug('acme'), name: 'Acme', now: NOW });
      await organizations.save(organization);

      const jti = 'confirm-e2e-jti';
      const user = User.create({
        id: createUserId(oid('user-1')),
        organizationId: ORG_ID,
        email: createEmail('alice@example.com'),
        credential: createPasswordCredential('hash'),
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: createRoleId('ANALYST'),
        now: NOW,
      }).beginPasswordReset(
        { hash: TOKEN_SERVICE.fingerprint(jti), expiresAt: fromDate(new Date('2026-01-01T00:15:00.000Z')) },
        NOW,
      );
      await userRepositoryFactory.forTenant(ORG_ID).save(user);

      return TOKEN_SERVICE.issue({
        tokenType: 'password_reset',
        keyVersion: 1,
        jti,
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        actorType: 'USER',
        expiresAt: fromDate(new Date('2026-01-01T00:15:00.000Z')),
      });
    }

    it('a valid unexpired reset token confirms with 204 and clears the pending reset', async () => {
      const { app, organizations, userRepositoryFactory } = buildApp();
      const token = await seedOrgAndUserWithPendingReset(organizations, userRepositoryFactory);

      const response = await request(app)
        .post('/api/v1/auth/users/password-reset/confirm')
        .send({ token, newPassword: 'BrandNewPassw0rd' });

      expect(response.status).toBe(204);
      const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId(oid('user-1')));
      expect(stored?.resetToken).toBeNull();
    });

    it('rejects an unknown/tampered token with 400 PASSWORD_RESET_INVALID', async () => {
      const { app, organizations, userRepositoryFactory } = buildApp();
      const token = await seedOrgAndUserWithPendingReset(organizations, userRepositoryFactory);

      const response = await request(app)
        .post('/api/v1/auth/users/password-reset/confirm')
        .send({ token: `${token}tampered`, newPassword: 'BrandNewPassw0rd' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PASSWORD_RESET_INVALID');
    });

    it('rejects a body with no token with 400 INVARIANT_VIOLATION (DTO-level validation)', async () => {
      const { app } = buildApp();

      const response = await request(app)
        .post('/api/v1/auth/users/password-reset/confirm')
        .send({ newPassword: 'BrandNewPassw0rd' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });
  });
});
