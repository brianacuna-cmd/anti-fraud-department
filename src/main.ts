import { Router } from 'express';
import { createApp } from './shared/http/createApp.js';
import { parseTrustProxy } from './shared/http/parseTrustProxy.js';
import { createErrorHandler } from './shared/http/errorHandler.js';
import { connectMongo } from './shared/persistence/mongo/connect.js';
import { ensureIndexes } from './shared/persistence/mongo/ensureIndexes.js';
import { SystemClock } from './shared/time/SystemClock.js';
import { identityAccessErrorStatus } from './modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { organizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/organizationRouter.js';
import { userRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/userRouter.js';
import { adminOrganizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/adminOrganizationRouter.js';
import { authRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import { assertAuthModeSafeForProduction } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/assertAuthModeSafeForProduction.js';
import { resolveAuthContextResolver } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/resolveAuthContextResolver.js';
import { createAuthContextMiddleware } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/authContextMiddleware.js';
import { MongoOrganizationRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { MongoSessionRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoSessionRepository.js';
import { UserActorGateway } from './modules/identity-access/infrastructure/adapters/outbound/mongo/UserActorGateway.js';
import { OrganizationActorGateway } from './modules/identity-access/infrastructure/adapters/outbound/mongo/OrganizationActorGateway.js';
import { MongoUnitOfWork } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAdminOrganizationRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoAdminOrganizationRepository.js';
import { BcryptPasswordHasher, DUMMY_PASSWORD_HASH } from './modules/identity-access/infrastructure/adapters/outbound/crypto/BcryptPasswordHasher.js';
import { AesGcmSecretCipher } from './modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from './modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { NodeAdminKeyPairGenerator } from './modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminKeyPairGenerator.js';
import { generateOrganizationId } from './modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { generateUserId } from './modules/identity-access/domain/model/value-objects/UserId.js';
import { generateAdminOrganizationId } from './modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { generateAdminKeyId } from './modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createGetOrganizationUseCase } from './modules/identity-access/application/GetOrganization.js';
import { createListOrganizationsUseCase } from './modules/identity-access/application/ListOrganizations.js';
import { createPatchOrganizationIdentityUseCase } from './modules/identity-access/application/PatchOrganizationIdentity.js';
import { createTransitionOrganizationStatusUseCase } from './modules/identity-access/application/TransitionOrganizationStatus.js';
import { createDeleteOrganizationUseCase } from './modules/identity-access/application/DeleteOrganization.js';
import { createCreateOrganizationWithAdminUseCase } from './modules/identity-access/application/CreateOrganizationWithAdmin.js';
import { createProvisionAdminOrganizationUseCase } from './modules/identity-access/application/admin/ProvisionAdminOrganization.js';
import { createCreateUserUseCase } from './modules/identity-access/application/CreateUser.js';
import { createGetUserUseCase } from './modules/identity-access/application/GetUser.js';
import { createListUsersUseCase } from './modules/identity-access/application/ListUsers.js';
import { createPatchUserIdentityUseCase } from './modules/identity-access/application/PatchUserIdentity.js';
import { createTransitionUserStatusUseCase } from './modules/identity-access/application/TransitionUserStatus.js';
import { createDeleteUserUseCase } from './modules/identity-access/application/DeleteUser.js';
import { createAuthenticateActorUseCase } from './modules/identity-access/application/auth/AuthenticateActor.js';
import { createLogoutUseCase } from './modules/identity-access/application/auth/Logout.js';
import { createPasswordCredential } from './modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { MongoAuditLogRepository } from './modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from './modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from './modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from './composition/auditRecorderAdapter.js';

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';
const AUTH_MODE = process.env.AUTH_MODE ?? 'trusted-header';
// Phase 3b (design D13): normalized via SHA-256 inside AesGcmSecretCipher —
// any length is accepted, but a real deployment MUST override the dev
// fallback. `TOKEN_KEY_VERSION` is a small integer (0-255, 1 byte on the
// wire) so a future key rotation only needs to bump this and start a new
// AesGcmSecretCipher instance; old tokens under the old version simply fail
// to decrypt (`decrypt` returns null, never throws).
const TOKEN_SECRET = process.env.TOKEN_SECRET ?? 'dev-only-insecure-token-secret';
const TOKEN_KEY_VERSION = Number(process.env.TOKEN_KEY_VERSION ?? 1);
// Fail-safe default `false` (design D-A7/§4a): a production deployment
// behind a real reverse proxy MUST set TRUST_PROXY explicitly, or `req.ip`
// stays the raw socket peer and never honors a spoofable `X-Forwarded-For`.
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

async function bootstrap(): Promise<void> {
  // Fail-closed (design D4): AUTH_MODE=trusted-header trusts client headers
  // verbatim and must never run in production.
  assertAuthModeSafeForProduction(process.env.NODE_ENV, AUTH_MODE);

  const { client, db } = await connectMongo(MONGO_URI, MONGO_DB_NAME);
  await ensureIndexes(db);

  const clock = new SystemClock();
  const organizations = new MongoOrganizationRepository(db);
  const userRepositoryFactory = new MongoUserRepositoryFactory(db);
  const sessions = new MongoSessionRepository(db);
  const admins = new MongoAdminOrganizationRepository(db);
  const passwordHasher = new BcryptPasswordHasher();
  // Phase 3b (design D13): the ONE AES-256-GCM primitive, layered — also
  // reused by MFA-secret encryption (mfa-totp spec) once that phase lands,
  // and by PR 1c's Ed25519 private-key encryption (design D32).
  const secretCipher = new AesGcmSecretCipher(TOKEN_SECRET, TOKEN_KEY_VERSION);
  const sessionTokenService = new AesGcmSessionTokenService(secretCipher);
  const adminKeyPairGenerator = new NodeAdminKeyPairGenerator();
  // Phase 3: a REAL Mongo-session-backed UnitOfWork — required for
  // CreateOrganizationWithAdmin's genuine cross-collection atomicity.
  // Phase 2's PassthroughUnitOfWork is deliberately NOT reused here.
  const unitOfWork = new MongoUnitOfWork(client);

  // audit-logs-foundation Phase 4 (design D-A2/D-A4, task 4.0): first real
  // consumer of the `audit` module — construction was deferred out of PR2
  // (feat/audit-recorder-wiring) to avoid dead code with no caller yet.
  const auditLogs = new MongoAuditLogRepository(db);
  const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock, generateAuditLogId });
  const auditRecorder = createAuditRecorderAdapter(recordAuditLog);

  const transitionOrganizationStatus = createTransitionOrganizationStatusUseCase({
    organizations,
    sessions,
    unitOfWork,
    clock,
    auditRecorder,
  });
  const transitionUserStatus = createTransitionUserStatusUseCase({ userRepositoryFactory, unitOfWork, clock });

  const identityAccessOrganizationsRouter = organizationRouter({
    createOrganizationWithAdmin: createCreateOrganizationWithAdminUseCase({
      organizations,
      userRepositoryFactory,
      passwordHasher,
      unitOfWork,
      clock,
      generateOrganizationId,
      generateUserId,
      auditRecorder,
    }),
    getOrganization: createGetOrganizationUseCase({ organizations }),
    listOrganizations: createListOrganizationsUseCase({ organizations }),
    patchOrganizationIdentity: createPatchOrganizationIdentityUseCase({ organizations, unitOfWork, clock, auditRecorder }),
    transitionOrganizationStatus,
    deleteOrganization: createDeleteOrganizationUseCase({ transitionOrganizationStatus }),
  });

  const identityAccessUsersRouter = userRouter({
    createUser: createCreateUserUseCase({ userRepositoryFactory, passwordHasher, clock, generateId: generateUserId }),
    getUser: createGetUserUseCase({ userRepositoryFactory }),
    listUsers: createListUsersUseCase({ userRepositoryFactory }),
    patchUserIdentity: createPatchUserIdentityUseCase({ userRepositoryFactory, clock }),
    transitionUserStatus,
    deleteUser: createDeleteUserUseCase({ transitionUserStatus }),
  });

  // Phase 3 (PR 1c, design D31/D32): provisioning only. Download/rotate/
  // revoke land on this same router in later PRs (2a/2c).
  const identityAccessAdminOrganizationsRouter = adminOrganizationRouter({
    provisionAdminOrganization: createProvisionAdminOrganizationUseCase({
      admins,
      keyPairs: adminKeyPairGenerator,
      cipher: secretCipher,
      unitOfWork,
      clock,
      generateAdminOrganizationId,
      generateAdminKeyId,
      auditRecorder,
    }),
  });

  // Phase 4 (design D19, D24): a fixed, valid bcrypt hash with no real
  // credential behind it — every unresolved login (unknown email, unknown
  // organizationSlug, credential-less organization) still pays the full
  // verify cost against this so failure timing is uniform (design D24).
  // Constructed here, not imported into `application/`, because `application`
  // may only depend on its own module's `domain` (eslint `boundaries`).
  const dummyCredential = createPasswordCredential(DUMMY_PASSWORD_HASH);
  const identityAccessAuthRouter = authRouter({
    authenticateUser: createAuthenticateActorUseCase({
      gateway: new UserActorGateway(organizations, userRepositoryFactory),
      passwordHasher,
      clock,
      dummyCredential,
    }),
    authenticateOrganization: createAuthenticateActorUseCase({
      gateway: new OrganizationActorGateway(organizations),
      passwordHasher,
      clock,
      dummyCredential,
    }),
    logout: createLogoutUseCase({ sessions, clock }),
  });

  const authContextMiddleware = createAuthContextMiddleware(
    resolveAuthContextResolver(AUTH_MODE, { sessionTokenService, sessionRepository: sessions }),
  );

  const identityAccessRouter = Router();
  identityAccessRouter.use(authContextMiddleware);
  identityAccessRouter.use(identityAccessAuthRouter);
  identityAccessRouter.use(identityAccessOrganizationsRouter);
  identityAccessRouter.use(identityAccessUsersRouter);
  identityAccessRouter.use(identityAccessAdminOrganizationsRouter);

  const app = createApp({
    routers: [{ path: '/api/v1', router: identityAccessRouter }],
    errorHandler: createErrorHandler(identityAccessErrorStatus),
    trustProxy: TRUST_PROXY,
  });

  app.listen(PORT, () => {
    console.log(`anti-fraud-department listening on port ${PORT}`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exitCode = 1;
});
