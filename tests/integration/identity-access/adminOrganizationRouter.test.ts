import { generateKeyPairSync, sign } from 'node:crypto';
import { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { authenticator } from 'otplib';
import type { Db, MongoClient } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { FakeEmailSender } from '../../helpers/identity-access/FakeEmailSender.js';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { adminOrganizationRouter } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/adminOrganizationRouter.js';
import { createProvisionAdminOrganizationUseCase } from '../../../src/modules/identity-access/application/admin/ProvisionAdminOrganization.js';
import { createRequestAdminChallengeUseCase } from '../../../src/modules/identity-access/application/admin/RequestAdminChallenge.js';
import { createVerifyAdminChallengeUseCase } from '../../../src/modules/identity-access/application/admin/VerifyAdminChallenge.js';
import { createDownloadAdminPrivateKeyUseCase } from '../../../src/modules/identity-access/application/admin/DownloadAdminPrivateKey.js';
import { createRotateAdminKeyUseCase } from '../../../src/modules/identity-access/application/admin/RotateAdminKey.js';
import { createRevokeAdminKeyUseCase } from '../../../src/modules/identity-access/application/admin/RevokeAdminKey.js';
import { createSessionIssuer } from '../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { InMemoryAdminOrganizationRepository } from '../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemoryAdminChallengeStore } from '../../helpers/identity-access/InMemoryAdminChallengeStore.js';
import { InMemorySessionRepository } from '../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakeAdminKeyPairGenerator } from '../../helpers/identity-access/FakeAdminKeyPairGenerator.js';
import { AesGcmSecretCipher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { NodeAdminSignatureVerifier } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminSignatureVerifier.js';
import { SessionTokenAuthContextResolver } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/SessionTokenAuthContextResolver.js';
import { createAuthContextMiddleware } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/authContextMiddleware.js';
import { AdminOrganization } from '../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId, generateAdminOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId, generateAdminKeyId } from '../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey } from '../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { oid } from '../../support/oid.js';
import { buildSession } from '../../helpers/identity-access/buildSession.js';
import { InMemoryUserRepositoryFactory } from '../../helpers/identity-access/InMemoryUserRepositoryFactory.js';

const PLATFORM_ADMIN = createAuthContext({ userId: oid('admin-1'), organizationId: null, isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('o1'), isPlatformAdmin: false });
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CANONICAL_PREFIX = 'AFD-ADMIN-CHALLENGE-V1\n';

function generateEd25519KeyPair(): { publicKeySpkiPem: string; privateKeyPkcs8Pem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeySpkiPem: publicKey as unknown as string, privateKeyPkcs8Pem: privateKey as unknown as string };
}

function signChallenge(challenge: string, privateKeyPkcs8Pem: string): string {
  const message = Buffer.from(CANONICAL_PREFIX + challenge, 'utf8');
  return sign(null, message, privateKeyPkcs8Pem).toString('base64');
}

let replicaSet: MongoMemoryReplSet;
let mongoClient: MongoClient;
let db: Db;

beforeAll(async () => {
  replicaSet = await startReplicaSetMongo();
  const connection = await connectMongo(replicaSet.getUri(), 'admin_router_test');
  mongoClient = connection.client;
  db = connection.db;
  await ensureIndexes(db);
});

afterAll(async () => {
  await mongoClient.close();
  await replicaSet.stop();
});

// El secreto TOTP se persiste entre pasos; sin limpiar, un test heredaria el
// enrolamiento del anterior y tomaria la rama de reto en vez de la de alta.
beforeEach(async () => {
  await db.collection('admin_organizations').deleteMany({});
});

function buildApp(actorPerRequest: () => AuthContext): {
  app: Express;
  admins: InMemoryAdminOrganizationRepository;
  sessions: InMemorySessionRepository;
  auditRecorder: InMemoryAuditRecorder;
  cipher: AesGcmSecretCipher;
} {
  const admins = new InMemoryAdminOrganizationRepository();
  const sessions = new InMemorySessionRepository();
  const keyPairs = new FakeAdminKeyPairGenerator();
  const cipher = new AesGcmSecretCipher('router-test-secret', 1);
  const clock = new SystemClock();
  const auditRecorder = new InMemoryAuditRecorder();

  const router = adminOrganizationRouter({
    db,
    provisionAdminOrganization: createProvisionAdminOrganizationUseCase({
      admins,
      keyPairs,
      cipher,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      generateAdminOrganizationId,
      generateAdminKeyId,
      auditRecorder: new InMemoryAuditRecorder(),
    }),
    requestAdminChallenge: createRequestAdminChallengeUseCase({
      admins,
      adminChallenges: new InMemoryAdminChallengeStore(),
      clock,
      challengeTtlSeconds: 86_400,
    }),
    verifyAdminChallenge: createVerifyAdminChallengeUseCase({
      admins,
      adminChallenges: new InMemoryAdminChallengeStore(),
      signatureVerifier: new NodeAdminSignatureVerifier(),
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      issueSessionFor: createSessionIssuer({
        sessionTokenService: new AesGcmSessionTokenService(cipher),
        sessions: new InMemorySessionRepository(),
        tokenKeyVersion: 1,
        ttls: { sessionSeconds: 900 },
      }),
      auditRecorder: new InMemoryAuditRecorder(),
    }),
    downloadAdminPrivateKey: createDownloadAdminPrivateKeyUseCase({
      admins,
      cipher,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      auditRecorder,
    }),
    rotateAdminKey: createRotateAdminKeyUseCase({
      admins,
      sessions,
      keyPairs,
      cipher,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      generateAdminKeyId,
      auditRecorder,
    }),
    revokeAdminKey: createRevokeAdminKeyUseCase({
      admins,
      sessions,
      unitOfWork: new InMemoryUnitOfWork(),
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

  return { app, admins, sessions, auditRecorder, cipher };
}

/**
 * Full-stack challenge-login harness (no shortcut `testAuthMiddleware`): the
 * router's own `requestAdminChallenge`/`verifyAdminChallenge` use cases mint
 * a REAL `Sessions` row, and a REAL `SessionTokenAuthContextResolver` +
 * `authContextMiddleware` resolve the returned bearer token — proving the
 * spec's "Authenticated request after login" scenario end-to-end, with no
 * new resolver logic (design "No change to prod-gate / resolver").
 */
function buildChallengeLoginApp(): {
  app: Express;
  admins: InMemoryAdminOrganizationRepository;
  adminChallenges: InMemoryAdminChallengeStore;
  sessions: InMemorySessionRepository;
  emailSender: FakeEmailSender;
} {
  const admins = new InMemoryAdminOrganizationRepository();
  const adminChallenges = new InMemoryAdminChallengeStore();
  const sessions = new InMemorySessionRepository();
  const emailSender = new FakeEmailSender();
  const cipher = new AesGcmSecretCipher('challenge-login-test-secret', 1);
  const sessionTokenService = new AesGcmSessionTokenService(cipher);
  // Real `SystemClock` (not `FixedClock`) — `SessionTokenAuthContextResolver`
  // checks `Session.expiresAt` against the REAL `Date.now()` (design: it has
  // no injected clock), so a minted session must be expiry-relative to real
  // wall-clock time for the protected-route round-trip below to resolve.
  const clock = new SystemClock();

  const router = adminOrganizationRouter({
    db,
    // 3-step admin login: the router generates the step-2 OTP and sends it
    // here — FakeEmailSender captures it so tests can complete the flow.
    emailSender,
    provisionAdminOrganization: createProvisionAdminOrganizationUseCase({
      admins,
      keyPairs: new FakeAdminKeyPairGenerator(),
      cipher,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      generateAdminOrganizationId,
      generateAdminKeyId,
      auditRecorder: new InMemoryAuditRecorder(),
    }),
    requestAdminChallenge: createRequestAdminChallengeUseCase({
      admins,
      adminChallenges,
      clock,
      challengeTtlSeconds: 86_400,
    }),
    verifyAdminChallenge: createVerifyAdminChallengeUseCase({
      admins,
      adminChallenges,
      signatureVerifier: new NodeAdminSignatureVerifier(),
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      issueSessionFor: createSessionIssuer({
        sessionTokenService,
        sessions,
        tokenKeyVersion: 1,
        ttls: { sessionSeconds: 900 },
      }),
      auditRecorder: new InMemoryAuditRecorder(),
    }),
    downloadAdminPrivateKey: createDownloadAdminPrivateKeyUseCase({
      admins,
      cipher,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      auditRecorder: new InMemoryAuditRecorder(),
    }),
    rotateAdminKey: createRotateAdminKeyUseCase({
      admins,
      sessions,
      keyPairs: new FakeAdminKeyPairGenerator(),
      cipher,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      generateAdminKeyId,
      auditRecorder: new InMemoryAuditRecorder(),
    }),
    revokeAdminKey: createRevokeAdminKeyUseCase({
      admins,
      sessions,
      unitOfWork: new InMemoryUnitOfWork(),
      clock,
      auditRecorder: new InMemoryAuditRecorder(),
    }),
  });

  const authContextMiddleware = createAuthContextMiddleware(
    new SessionTokenAuthContextResolver(sessionTokenService, sessions, new InMemoryUserRepositoryFactory()),
  );

  const mounted = Router();
  mounted.use(authContextMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(identityAccessErrorStatus),
  });

  return { app, admins, adminChallenges, sessions, emailSender };
}

async function seedAdminWithActiveKey(
  admins: InMemoryAdminOrganizationRepository,
  keyPair: { publicKeySpkiPem: string },
  id = 'admin-challenge-1',
) {
  const admin = AdminOrganization.create({
    id: createAdminOrganizationId(oid(id)),
    email: createEmail('root@platform.internal'),
    keys: [
      createAdminKey({
        keyId: createAdminKeyId(oid('key-1')),
        publicKey: keyPair.publicKeySpkiPem,
        status: 'ACTIVE',
        encryptedPrivateKey: 'ciphertext',
        createdAt: NOW,
      }),
    ],
    now: NOW,
  });
  await admins.save(admin);
  return admin;
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

/**
 * Completes steps 2 and 3 of the 3-step admin login after a successful
 * verify-challenge: extracts the OTP from the last email captured by
 * FakeEmailSender, verifies it (returns the enrollment TOTP secret) and
 * answers the TOTP challenge with an otplib code. Returns the final
 * response with `{ accessToken, expiresAt }`.
 */
async function completeAdminMfaSteps(app: Express, emailSender: FakeEmailSender, challengeToken: string) {
  const otpMail = emailSender.sent[emailSender.sent.length - 1]!;
  const otp = /(\d{6})/.exec(otpMail.text)![1]!;
  const verify = await request(app).post('/api/v1/admin-organizations/otp/verify').send({ challengeToken, otp });
  expect(verify.status).toBe(200);
  const code = authenticator.generate(verify.body.secret as string);
  return request(app).post('/api/v1/admin-organizations/mfa').send({ challengeToken, code });
}

describe('PLATFORM_ADMIN challenge-login (e2e, super-admin-auth PR1)', () => {
  it('full round-trip: request-challenge -> sign with real Ed25519 key -> verify-challenge -> OTP -> TOTP -> access a platform-admin-gated route', async () => {
    const { app, admins, emailSender } = buildChallengeLoginApp();
    const keyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);

    const challengeResponse = await request(app)
      .post('/api/v1/admin-organizations/challenges')
      .send({ adminOrganizationId: admin.id });
    expect(challengeResponse.status).toBe(201);
    expect(typeof challengeResponse.body.challengeId).toBe('string');
    expect(typeof challengeResponse.body.challenge).toBe('string');
    expect(challengeResponse.body.challengeId).not.toBe(challengeResponse.body.challenge);

    const signature = signChallenge(challengeResponse.body.challenge, keyPair.privateKeyPkcs8Pem);
    const sessionResponse = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId: challengeResponse.body.challengeId, signature });

    // 3-step contract: a valid signature opens the OTP step — the access
    // token is only delivered after OTP + TOTP.
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.status).toBe('OTP_REQUIRED');
    expect(typeof sessionResponse.body.challengeToken).toBe('string');
    expect(sessionResponse.body.accessToken).toBeUndefined();

    const mfaResponse = await completeAdminMfaSteps(app, emailSender, sessionResponse.body.challengeToken);
    expect(mfaResponse.status).toBe(200);
    expect(typeof mfaResponse.body.accessToken).toBe('string');
    expect(mfaResponse.body.refreshToken).toBeUndefined();

    // The minted PLATFORM_ADMIN access token authorizes on the existing
    // platform-admin-gated route (spec "Authenticated request after login")
    // through the UNCHANGED SessionTokenAuthContextResolver — no new
    // resolver logic.
    const protectedResponse = await request(app)
      .post('/api/v1/admin-organizations')
      .set('Authorization', `Bearer ${mfaResponse.body.accessToken}`)
      .send({ email: 'second-admin@platform.internal' });

    expect(protectedResponse.status).toBe(201);
    expect(protectedResponse.body.email).toBe('second-admin@platform.internal');
  });

  it('rejects a forged signature with 401, and the challenge remains usable for a retry', async () => {
    const { app, admins } = buildChallengeLoginApp();
    const keyPair = generateEd25519KeyPair();
    const forgerKeyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);

    const challengeResponse = await request(app)
      .post('/api/v1/admin-organizations/challenges')
      .send({ adminOrganizationId: admin.id });
    const { challengeId, challenge } = challengeResponse.body;

    const forgedSignature = signChallenge(challenge, forgerKeyPair.privateKeyPkcs8Pem);
    const forgedResponse = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId, signature: forgedSignature });

    expect(forgedResponse.status).toBe(401);
    expect(forgedResponse.body.error.code).toBe('ADMIN_CHALLENGE_INVALID');

    // Retry with the correct signature against the SAME challenge succeeds
    // (design "Bad signature does NOT consume the challenge").
    const validSignature = signChallenge(challenge, keyPair.privateKeyPkcs8Pem);
    const retryResponse = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId, signature: validSignature });

    // 3-step contract: a valid signature opens the OTP step.
    expect(retryResponse.status).toBe(200);
    expect(retryResponse.body.status).toBe('OTP_REQUIRED');
    expect(typeof retryResponse.body.challengeToken).toBe('string');
  });

  it('rejects an expired challenge with 401 (spec "Expired challenge")', async () => {
    const { app, admins, adminChallenges } = buildChallengeLoginApp();
    const keyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);
    const challengeId = 'expired-challenge-id';
    const challenge = 'a-known-raw-challenge-value';
    await adminChallenges.append({
      challengeId,
      adminOrganizationId: admin.id,
      challenge,
      expiresAt: fromDate(new Date('2025-12-31T23:59:00.000Z')), // before FixedClock's NOW
      now: fromDate(new Date('2025-12-31T00:00:00.000Z')),
    });
    const signature = signChallenge(challenge, keyPair.privateKeyPkcs8Pem);

    const response = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId, signature });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ADMIN_CHALLENGE_INVALID');
  });

  it('rejects a replayed (already-consumed) challenge with 401, no second session (spec "Replayed challenge")', async () => {
    const { app, admins } = buildChallengeLoginApp();
    const keyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);

    const challengeResponse = await request(app)
      .post('/api/v1/admin-organizations/challenges')
      .send({ adminOrganizationId: admin.id });
    const { challengeId, challenge } = challengeResponse.body;
    const signature = signChallenge(challenge, keyPair.privateKeyPkcs8Pem);

    const first = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId, signature });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('OTP_REQUIRED');

    const replay = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId, signature });

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('ADMIN_CHALLENGE_INVALID');
  });

  it('rejects a signature from a DEPRECATED key with 401 (spec "Signature by a non-ACTIVE key")', async () => {
    const { app, admins, adminChallenges } = buildChallengeLoginApp();
    const deprecatedKeyPair = generateEd25519KeyPair();
    const activeKeyPair = generateEd25519KeyPair();
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-rotated-e2e')),
      email: createEmail('rotated-e2e@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-old')),
          publicKey: deprecatedKeyPair.publicKeySpkiPem,
          status: 'DEPRECATED',
          encryptedPrivateKey: null,
          createdAt: NOW,
          rotatedAt: NOW,
        }),
        createAdminKey({
          keyId: createAdminKeyId(oid('key-new')),
          publicKey: activeKeyPair.publicKeySpkiPem,
          status: 'ACTIVE',
          encryptedPrivateKey: 'ciphertext',
          createdAt: NOW,
        }),
      ],
      now: NOW,
    });
    await admins.save(admin);
    const challengeId = 'deprecated-key-challenge-id';
    const challenge = 'another-known-raw-challenge-value';
    await adminChallenges.append({
      challengeId,
      adminOrganizationId: admin.id,
      challenge,
      expiresAt: fromDate(new Date('2026-01-02T00:00:00.000Z')),
      now: NOW,
    });
    const signatureFromDeprecatedKey = signChallenge(challenge, deprecatedKeyPair.privateKeyPkcs8Pem);

    const response = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId, signature: signatureFromDeprecatedKey });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ADMIN_CHALLENGE_INVALID');
  });

  it('rejects request-challenge for an unknown adminOrganizationId with the same opaque error (no enumeration oracle)', async () => {
    const { app } = buildChallengeLoginApp();

    const response = await request(app)
      .post('/api/v1/admin-organizations/challenges')
      .send({ adminOrganizationId: oid('never-provisioned') });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ADMIN_CHALLENGE_INVALID');
  });

  it('rejects verify-challenge for an unknown challengeId with 401 (spec "Unknown challenge")', async () => {
    const { app } = buildChallengeLoginApp();

    const response = await request(app)
      .post('/api/v1/admin-organizations/sessions')
      .send({ challengeId: 'never-appended', signature: 'irrelevant' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ADMIN_CHALLENGE_INVALID');
  });
});

describe('PLATFORM_ADMIN key lifecycle (e2e, super-admin-auth PR2)', () => {
  it('POST .../keys/:keyId/download returns the plaintext PEM exactly once, then 409 on retry', async () => {
    const { app, admins, cipher } = buildApp(() => PLATFORM_ADMIN);
    const plaintextPem = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n';
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-download-1')),
      email: createEmail('download@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-1')),
          publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
          status: 'ACTIVE',
          encryptedPrivateKey: cipher.encrypt(plaintextPem),
          createdAt: NOW,
        }),
      ],
      now: NOW,
    });
    await admins.save(admin);

    const first = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/${oid('key-1')}/download`).send();
    expect(first.status).toBe(200);
    expect(first.body.privateKeyPkcs8Pem).toBe(plaintextPem);

    const second = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/${oid('key-1')}/download`).send();
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ADMIN_PRIVATE_KEY_UNAVAILABLE');
  });

  it('download response never contains the ciphertext field name', async () => {
    const { app, admins, cipher } = buildApp(() => PLATFORM_ADMIN);
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-download-2')),
      email: createEmail('download2@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-1')),
          publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
          status: 'ACTIVE',
          encryptedPrivateKey: cipher.encrypt('-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n'),
          createdAt: NOW,
        }),
      ],
      now: NOW,
    });
    await admins.save(admin);

    const response = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/${oid('key-1')}/download`).send();

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('encryptedPrivateKey');
  });

  it('rejects a non-platform-admin download attempt with 403', async () => {
    const { app, admins } = buildApp(() => REGULAR_USER);
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-download-3')),
      email: createEmail('download3@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-1')),
          publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
          status: 'ACTIVE',
          encryptedPrivateKey: 'ciphertext',
          createdAt: NOW,
        }),
      ],
      now: NOW,
    });
    await admins.save(admin);

    const response = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/${oid('key-1')}/download`).send();

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('POST .../keys/rotate demotes the old key and activates a new one, cascading session revocation', async () => {
    const { app, admins, sessions } = buildApp(() => PLATFORM_ADMIN);
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-rotate-1')),
      email: createEmail('rotate@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-old')),
          publicKey: '-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----\n',
          status: 'ACTIVE',
          encryptedPrivateKey: 'ciphertext',
          createdAt: NOW,
        }),
      ],
      now: NOW,
    });
    await admins.save(admin);
    await sessions.save(
      buildSession({
        id: oid('session-rotate-1'),
        adminOrganizationId: admin.id,
        tokenHash: 'rotate-token-hash',
        now: NOW,
        expiresAt: fromDate(new Date('2026-02-01T00:00:00.000Z')),
      }),
    );

    const response = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/rotate`).send();

    expect(response.status).toBe(200);
    expect(response.body.keys).toHaveLength(2);
    const oldKey = response.body.keys.find((k: { keyId: string }) => k.keyId === oid('key-old'));
    expect(oldKey.status).toBe('DEPRECATED');
    const activeKeys = response.body.keys.filter((k: { status: string }) => k.status === 'ACTIVE');
    expect(activeKeys).toHaveLength(1);

    const cascadedSession = await sessions.findByTokenHash('rotate-token-hash');
    expect(cascadedSession?.deletedAt).not.toBeNull();
  });

  it('rejects rotate for an unknown adminOrganizationId with 404', async () => {
    const { app } = buildApp(() => PLATFORM_ADMIN);

    const response = await request(app).post(`/api/v1/admin-organizations/${oid('never-provisioned')}/keys/rotate`).send();

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ADMIN_ORGANIZATION_NOT_FOUND');
  });

  it('POST .../keys/:keyId/revoke marks the key REVOKED (terminal) and rejects a second revoke', async () => {
    const { app, admins } = buildApp(() => PLATFORM_ADMIN);
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-revoke-1')),
      email: createEmail('revoke@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-1')),
          publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
          status: 'ACTIVE',
          encryptedPrivateKey: 'ciphertext',
          createdAt: NOW,
        }),
      ],
      now: NOW,
    });
    await admins.save(admin);

    const first = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/${oid('key-1')}/revoke`).send();
    expect(first.status).toBe(200);
    expect(first.body.keys[0].status).toBe('REVOKED');

    const second = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/${oid('key-1')}/revoke`).send();
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('rejects a non-platform-admin revoke attempt with 403', async () => {
    const { app, admins } = buildApp(() => REGULAR_USER);
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-revoke-2')),
      email: createEmail('revoke2@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-1')),
          publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
          status: 'ACTIVE',
          encryptedPrivateKey: 'ciphertext',
          createdAt: NOW,
        }),
      ],
      now: NOW,
    });
    await admins.save(admin);

    const response = await request(app).post(`/api/v1/admin-organizations/${admin.id}/keys/${oid('key-1')}/revoke`).send();

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });
});
