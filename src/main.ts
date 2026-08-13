import { existsSync } from 'node:fs';
import { Router } from 'express';

if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // ignore
  }
}
import { createApp } from './shared/http/createApp.js';
import { parseTrustProxy } from './shared/http/parseTrustProxy.js';
import { createErrorHandler } from './shared/http/errorHandler.js';
import { connectMongo } from './shared/persistence/mongo/connect.js';
import { ensureIndexes } from './shared/persistence/mongo/ensureIndexes.js';
import { ensureRoles } from './shared/persistence/mongo/ensureRoles.js';
import { SystemClock } from './shared/time/SystemClock.js';
import { identityAccessErrorStatus } from './modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { organizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/organizationRouter.js';
import { userRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/userRouter.js';
import { adminOrganizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/adminOrganizationRouter.js';
import { authRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import { assertAuthConfigSafeForProduction } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/assertAuthConfigSafeForProduction.js';
import { resolveAuthContextResolver } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/resolveAuthContextResolver.js';
import { createAuthContextMiddleware } from './modules/identity-access/infrastructure/adapters/inbound/http/auth/authContextMiddleware.js';
import { MongoOrganizationRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoOrganizationRepository.js';
import { MongoUserRepositoryFactory } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { MongoSessionRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoSessionRepository.js';
import { UserActorGateway } from './modules/identity-access/infrastructure/adapters/outbound/mongo/UserActorGateway.js';
import { OrganizationActorGateway } from './modules/identity-access/infrastructure/adapters/outbound/mongo/OrganizationActorGateway.js';
import { MongoUnitOfWork } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAdminOrganizationRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoAdminOrganizationRepository.js';
import { MongoRoleRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoRoleRepository.js';
import { BcryptPasswordHasher, DUMMY_PASSWORD_HASH } from './modules/identity-access/infrastructure/adapters/outbound/crypto/BcryptPasswordHasher.js';
import { AesGcmSecretCipher } from './modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from './modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { NodeAdminKeyPairGenerator } from './modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminKeyPairGenerator.js';
import { NodeAdminSignatureVerifier } from './modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminSignatureVerifier.js';
import { MongoAdminChallengeRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoAdminChallengeRepository.js';
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
import { createRequestAdminChallengeUseCase } from './modules/identity-access/application/admin/RequestAdminChallenge.js';
import { createVerifyAdminChallengeUseCase } from './modules/identity-access/application/admin/VerifyAdminChallenge.js';
import { createDownloadAdminPrivateKeyUseCase } from './modules/identity-access/application/admin/DownloadAdminPrivateKey.js';
import { createRotateAdminKeyUseCase } from './modules/identity-access/application/admin/RotateAdminKey.js';
import { createRevokeAdminKeyUseCase } from './modules/identity-access/application/admin/RevokeAdminKey.js';
import { createCreateUserUseCase } from './modules/identity-access/application/CreateUser.js';
import { createGetUserUseCase } from './modules/identity-access/application/GetUser.js';
import { createListUsersUseCase } from './modules/identity-access/application/ListUsers.js';
import { createPatchUserIdentityUseCase } from './modules/identity-access/application/PatchUserIdentity.js';
import { createTransitionUserStatusUseCase } from './modules/identity-access/application/TransitionUserStatus.js';
import { createDeleteUserUseCase } from './modules/identity-access/application/DeleteUser.js';
import { createSetupMfaUseCase } from './modules/identity-access/application/SetupMfa.js';
import { createActivateMfaUseCase } from './modules/identity-access/application/ActivateMfa.js';
import { createDisableMfaUseCase } from './modules/identity-access/application/DisableMfa.js';
import { createChangePasswordUseCase } from './modules/identity-access/application/ChangePassword.js';
import { createChangeUserRoleUseCase } from './modules/identity-access/application/ChangeUserRole.js';
import { createRequestPasswordResetUseCase } from './modules/identity-access/application/auth/RequestPasswordReset.js';
import { createConfirmPasswordResetUseCase } from './modules/identity-access/application/auth/ConfirmPasswordReset.js';
import { ResendEmailSender } from './modules/identity-access/infrastructure/adapters/outbound/email/ResendEmailSender.js';
import { LogEmailSender } from './modules/identity-access/infrastructure/adapters/outbound/email/LogEmailSender.js';
import { OtplibTotpService } from './modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { QrCodeDataUrlGenerator } from './modules/identity-access/infrastructure/adapters/outbound/mfa/QrCodeDataUrlGenerator.js';
import { createAuthenticateActorUseCase } from './modules/identity-access/application/auth/AuthenticateActor.js';
import { createBeginUserLoginUseCase } from './modules/identity-access/application/auth/BeginUserLogin.js';
import { createSessionIssuer } from './modules/identity-access/application/auth/SessionIssuer.js';
import { createIssueSessionUseCase } from './modules/identity-access/application/auth/IssueSession.js';
import { createIssueOrganizationSessionUseCase } from './modules/identity-access/application/auth/IssueOrganizationSession.js';
import { createRefreshSessionUseCase } from './modules/identity-access/application/auth/RefreshSession.js';
import { createLogoutUseCase } from './modules/identity-access/application/auth/Logout.js';
import { MongoMfaChallengeRepository } from './modules/identity-access/infrastructure/adapters/outbound/mongo/MongoMfaChallengeRepository.js';
import { createPasswordCredential } from './modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { MongoAuditLogRepository } from './modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from './modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from './modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from './composition/auditRecorderAdapter.js';
import { createNotificationsAuditRecorderAdapter } from './composition/notificationsAuditRecorderAdapter.js';
import { MongoNotificationPreferenceRepository } from './modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationPreferenceRepository.js';
import { MongoUnitOfWork as NotificationsMongoUnitOfWork } from './modules/notifications/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createGetNotificationPreferencesUseCase } from './modules/notifications/application/GetNotificationPreferences.js';
import { createSetNotificationPreferenceUseCase } from './modules/notifications/application/SetNotificationPreference.js';
import { notificationPreferenceRouter } from './modules/notifications/infrastructure/adapters/inbound/http/notificationPreferenceRouter.js';
import { notificationsErrorStatus } from './modules/notifications/infrastructure/adapters/inbound/http/errorStatus.js';

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';
const AUTH_MODE = process.env.AUTH_MODE ?? 'trusted-header';
// two-step-login PR1b (design D6): PLATFORM_ADMIN has no session-issuing
// login yet, so its auth availability is decoupled from AUTH_MODE and
// governed by its own env — default 'disabled' is prod-safe (a
// PLATFORM_ADMIN request 401s explicitly instead of silently trusting
// headers); 'trusted-header' is a non-prod-only interim path until
// identity-access-super-admin-auth ships a real admin login.
// `assertAuthConfigSafeForProduction` refuses to start with
// PLATFORM_ADMIN_AUTH=trusted-header in production.
const PLATFORM_ADMIN_AUTH = process.env.PLATFORM_ADMIN_AUTH ?? 'disabled';
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
// mfa-user-enrollment PR2: otpauth issuer name shown in the user's
// authenticator app — a plain env-overridable constant, not secret.
const AUTH_TOTP_ISSUER = process.env.AUTH_TOTP_ISSUER ?? 'AntiFraud';
// two-step-login PR1a (design "TTLs"): short-lived single-use MFA token
// TTLs, parsed here (TOKEN_SECRET pattern) so the env contract exists from
// this PR onward. two-step-login PR2: `BeginUserLogin`/`IssueSession` are
// now the first real callers — `MongoMfaChallengeRepository` is
// constructed below (no longer dead code).
const AUTH_MFA_CHALLENGE_TTL_SECONDS = Number(process.env.AUTH_MFA_CHALLENGE_TTL_SECONDS ?? 300);
const AUTH_MFA_ENROLLMENT_TTL_SECONDS = Number(process.env.AUTH_MFA_ENROLLMENT_TTL_SECONDS ?? 900);
// two-step-login PR2 (design "TTLs"): the real `Sessions` row TTLs a minted
// ACCESS/REFRESH pair carries — first consumed by `SessionIssuer` in this
// PR (`IssueSession`'s challenge path); PR3's `ActivateMfa` reuses the same
// collaborator/TTLs for the enrollment hand-off.
const AUTH_SESSION_TTL_SECONDS = Number(process.env.AUTH_SESSION_TTL_SECONDS ?? 900);
const AUTH_REFRESH_TTL_SECONDS = Number(process.env.AUTH_REFRESH_TTL_SECONDS ?? 1_209_600);
const AUTH_FAMILY_TTL_SECONDS = Number(process.env.AUTH_FAMILY_TTL_SECONDS ?? 2_592_000);
// super-admin-auth PR1 (design "AdminChallengeStore", TTL): ~24h single-use
// PLATFORM_ADMIN login challenge TTL. Deferred from PR 1b (`ensureIndexes.ts`'s
// TTL index) to this PR — `RequestAdminChallenge` is the first real consumer.
const AUTH_ADMIN_CHALLENGE_TTL_SECONDS = Number(process.env.AUTH_ADMIN_CHALLENGE_TTL_SECONDS ?? 86_400);
// password-management PR-2b (design §6 "HTTP + DTOs + main.ts"): reset
// token TTL (15 min default, spec "Request Password Reset"), the outbound
// address `EmailSender` stamps on every reset email, and the base URL the
// reset link is built against (`?token=...`, design §5). `RESEND_API_KEY`
// selects which `EmailSender` adapter is constructed — set -> `ResendEmailSender`,
// unset (local/dev/CI default) -> `LogEmailSender` (spec "Adapter fallback
// with no API key").
const AUTH_PASSWORD_RESET_TTL_SECONDS = Number(process.env.AUTH_PASSWORD_RESET_TTL_SECONDS ?? 900);
const PASSWORD_RESET_EMAIL_FROM = process.env.PASSWORD_RESET_EMAIL_FROM ?? 'fraud@backendstudio.tech';
const PASSWORD_RESET_LINK_BASE_URL = process.env.PASSWORD_RESET_LINK_BASE_URL ?? 'http://localhost:3000/reset-password';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function bootstrap(): Promise<void> {
  // Fail-closed (design D4, D6): AUTH_MODE=trusted-header trusts client
  // headers verbatim and must never run in production; PLATFORM_ADMIN_AUTH=
  // trusted-header is likewise production-forbidden for every tier.
  assertAuthConfigSafeForProduction(process.env.NODE_ENV, AUTH_MODE, PLATFORM_ADMIN_AUTH);

  const { client, db } = await connectMongo(MONGO_URI, MONGO_DB_NAME);
  const clock = new SystemClock();
  await ensureIndexes(db);
  // user-roles PR-1a: idempotent fixed role-catalog seed (ADMIN/SUPERVISOR/
  // ANALYST/AUDITOR) — must run before any request that could reference a
  // role.
  await ensureRoles(db, clock.now());

  const organizations = new MongoOrganizationRepository(db);
  const userRepositoryFactory = new MongoUserRepositoryFactory(db);
  const sessions = new MongoSessionRepository(db);
  const admins = new MongoAdminOrganizationRepository(db);
  // user-roles PR-1b: first real consumer — construction was deferred out of
  // PR-1a to avoid dead code with no caller yet (this file's existing
  // precedent, see `mfaChallenges`/`adminChallenges` below).
  const roleRepository = new MongoRoleRepository(db);
  const passwordHasher = new BcryptPasswordHasher();
  // Phase 3b (design D13): the ONE AES-256-GCM primitive, layered — also
  // reused by MFA-secret encryption (mfa-totp spec) once that phase lands,
  // and by PR 1c's Ed25519 private-key encryption (design D32).
  const secretCipher = new AesGcmSecretCipher(TOKEN_SECRET, TOKEN_KEY_VERSION);
  const sessionTokenService = new AesGcmSessionTokenService(secretCipher);
  const adminKeyPairGenerator = new NodeAdminKeyPairGenerator();
  // super-admin-auth PR1 (design "Ed25519 SignatureVerifier"): the only
  // adapter allowed to call `node:crypto`'s `verify` for the admin tier.
  const adminSignatureVerifier = new NodeAdminSignatureVerifier();
  // mfa-user-enrollment PR2: the same otplib/qrcode adapters wired to their
  // real ports (identical shape to `secretCipher` above).
  const totpService = new OtplibTotpService();
  const qrCodeGenerator = new QrCodeDataUrlGenerator();
  // Phase 3: a REAL Mongo-session-backed UnitOfWork — required for
  // CreateOrganizationWithAdmin's genuine cross-collection atomicity.
  // Phase 2's PassthroughUnitOfWork is deliberately NOT reused here.
  const unitOfWork = new MongoUnitOfWork(client);
  // password-management PR-2b (design §4): first real consumer of the
  // `EmailSender` port constructed in PR-2a — `RESEND_API_KEY` set selects
  // the real Resend-backed adapter, otherwise the log/no-op fallback.
  const emailSender = RESEND_API_KEY ? new ResendEmailSender(RESEND_API_KEY) : new LogEmailSender();

  // audit-logs-foundation Phase 4 (design D-A2/D-A4, task 4.0): first real
  // consumer of the `audit` module — construction was deferred out of PR2
  // (feat/audit-recorder-wiring) to avoid dead code with no caller yet.
  // two-step-login PR2: first real consumer — construction was deferred out
  // of PR1a to avoid dead code with no caller yet (this same file's
  // existing precedent).
  const mfaChallenges = new MongoMfaChallengeRepository(db);
  // super-admin-auth PR1 (design "AdminChallengeStore"): first real consumer
  // — construction was deferred out of PR 1b to avoid dead code with no
  // caller yet (this same file's existing precedent, see `mfaChallenges`).
  const adminChallenges = new MongoAdminChallengeRepository(db);

  const auditLogs = new MongoAuditLogRepository(db);
  const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock, generateAuditLogId });
  const auditRecorder = createAuditRecorderAdapter(recordAuditLog);

  // notification-preferences PR3: the `notifications` module wires against the
  // SAME `recordAuditLog` instance via its OWN composition-root bridge (its
  // `AuditRecorder` port is nominally distinct from identity-access's, design
  // D12). Own `MongoUnitOfWork` instance so the preference upsert + audit row
  // commit atomically (design D11).
  const notificationPreferences = new MongoNotificationPreferenceRepository(db);
  const notificationsUnitOfWork = new NotificationsMongoUnitOfWork(client);
  const notificationsAuditRecorder = createNotificationsAuditRecorderAdapter(recordAuditLog);
  const getNotificationPreferences = createGetNotificationPreferencesUseCase({
    repository: notificationPreferences,
  });
  const setNotificationPreference = createSetNotificationPreferenceUseCase({
    repository: notificationPreferences,
    unitOfWork: notificationsUnitOfWork,
    clock,
    auditRecorder: notificationsAuditRecorder,
  });

  const transitionOrganizationStatus = createTransitionOrganizationStatusUseCase({
    organizations,
    sessions,
    unitOfWork,
    clock,
    auditRecorder,
  });
  const transitionUserStatus = createTransitionUserStatusUseCase({
    userRepositoryFactory,
    sessions,
    unitOfWork,
    clock,
    auditRecorder,
  });

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

  // two-step-login PR2 (design "IssueSession flow", "PR Slicing" Slice 2):
  // the shared session-minting collaborator — `IssueSession` and `ActivateMfa`
  // (PR3, forced-enrollment hand-off) both call it inside their own
  // transaction. Constructed here, ahead of `identityAccessUsersRouter`,
  // because `ActivateMfa` (PR3) is now a real consumer.
  const sessionIssuer = createSessionIssuer({
    sessionTokenService,
    sessions,
    tokenKeyVersion: TOKEN_KEY_VERSION,
    ttls: {
      sessionSeconds: AUTH_SESSION_TTL_SECONDS,
      refreshSeconds: AUTH_REFRESH_TTL_SECONDS,
      familySeconds: AUTH_FAMILY_TTL_SECONDS,
    },
  });

  const identityAccessUsersRouter = userRouter({
    createUser: createCreateUserUseCase({
      userRepositoryFactory,
      passwordHasher,
      unitOfWork,
      clock,
      generateId: generateUserId,
      auditRecorder,
      roleRepository,
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
      totpService,
      qrCodeGenerator,
      secretCipher,
      issuer: AUTH_TOTP_ISSUER,
    }),
    activateMfa: createActivateMfaUseCase({
      userRepositoryFactory,
      unitOfWork,
      clock,
      totpService,
      secretCipher,
      auditRecorder,
      mfaChallenges,
      issueSessionFor: sessionIssuer,
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
      roleRepository,
      unitOfWork,
      clock,
      auditRecorder,
    }),
  });

  // Phase 3 (PR 1c, design D31/D32) + super-admin-auth PR1 (design
  // "Use cases"): provisioning (platform-admin-gated) plus the two public
  // challenge-login routes. super-admin-auth PR2 (design "PR-2 key
  // lifecycle") adds the three `requirePlatformAdmin`-gated key-lifecycle
  // routes on this same router — one-time download, rotation, revocation.
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
    requestAdminChallenge: createRequestAdminChallengeUseCase({
      admins,
      adminChallenges,
      clock,
      challengeTtlSeconds: AUTH_ADMIN_CHALLENGE_TTL_SECONDS,
    }),
    verifyAdminChallenge: createVerifyAdminChallengeUseCase({
      admins,
      adminChallenges,
      signatureVerifier: adminSignatureVerifier,
      unitOfWork,
      clock,
      issueSessionFor: sessionIssuer,
      auditRecorder,
    }),
    downloadAdminPrivateKey: createDownloadAdminPrivateKeyUseCase({
      admins,
      cipher: secretCipher,
      unitOfWork,
      clock,
      auditRecorder,
    }),
    rotateAdminKey: createRotateAdminKeyUseCase({
      admins,
      sessions,
      keyPairs: adminKeyPairGenerator,
      cipher: secretCipher,
      unitOfWork,
      clock,
      generateAdminKeyId,
      auditRecorder,
    }),
    revokeAdminKey: createRevokeAdminKeyUseCase({
      admins,
      sessions,
      unitOfWork,
      clock,
      auditRecorder,
    }),
    db,
  });

  // Phase 4 (design D19, D24): a fixed, valid bcrypt hash with no real
  // credential behind it — every unresolved login (unknown email, unknown
  // organizationSlug, credential-less organization) still pays the full
  // verify cost against this so failure timing is uniform (design D24).
  // Constructed here, not imported into `application/`, because `application`
  // may only depend on its own module's `domain` (eslint `boundaries`).
  const dummyCredential = createPasswordCredential(DUMMY_PASSWORD_HASH);
  const identityAccessAuthRouter = authRouter({
    beginUserLogin: createBeginUserLoginUseCase({
      authenticateActor: createAuthenticateActorUseCase({
        gateway: new UserActorGateway(organizations, userRepositoryFactory),
        passwordHasher,
        clock,
        dummyCredential,
        actorType: 'USER',
        auditRecorder,
      }),
      sessionTokenService,
      mfaChallenges,
      clock,
      tokenKeyVersion: TOKEN_KEY_VERSION,
      challengeTtlSeconds: AUTH_MFA_CHALLENGE_TTL_SECONDS,
      enrollmentTtlSeconds: AUTH_MFA_ENROLLMENT_TTL_SECONDS,
    }),
    issueOrganizationSession: createIssueOrganizationSessionUseCase({
      authenticateActor: createAuthenticateActorUseCase({
        gateway: new OrganizationActorGateway(organizations),
        passwordHasher,
        clock,
        dummyCredential,
        actorType: 'ORGANIZATION',
        auditRecorder,
      }),
      issueSessionFor: sessionIssuer,
      unitOfWork,
      clock,
      auditRecorder,
    }),
    issueSession: createIssueSessionUseCase({
      sessionTokenService,
      mfaChallenges,
      userRepositoryFactory,
      totpService,
      secretCipher,
      unitOfWork,
      clock,
      issueSessionFor: sessionIssuer,
      auditRecorder,
    }),
    refreshSession: createRefreshSessionUseCase({
      sessionTokenService,
      sessions,
      issueSessionFor: sessionIssuer,
      unitOfWork,
      clock,
      auditRecorder,
    }),
    logout: createLogoutUseCase({ sessions, clock, auditRecorder }),
    requestPasswordReset: createRequestPasswordResetUseCase({
      organizations,
      userRepositoryFactory,
      sessionTokenService,
      unitOfWork,
      emailSender,
      auditRecorder,
      clock,
      tokenKeyVersion: TOKEN_KEY_VERSION,
      resetTtlSeconds: AUTH_PASSWORD_RESET_TTL_SECONDS,
      emailFrom: PASSWORD_RESET_EMAIL_FROM,
      resetLinkBaseUrl: PASSWORD_RESET_LINK_BASE_URL,
    }),
    confirmPasswordReset: createConfirmPasswordResetUseCase({
      sessionTokenService,
      userRepositoryFactory,
      passwordHasher,
      sessions,
      unitOfWork,
      clock,
      auditRecorder,
    }),
    emailSender,
    db,
  });

  const authContextMiddleware = createAuthContextMiddleware(
    resolveAuthContextResolver(AUTH_MODE, {
      sessionTokenService,
      sessionRepository: sessions,
      platformAdminAuth: PLATFORM_ADMIN_AUTH,
    }),
  );

  const identityAccessRouter = Router();
  identityAccessRouter.use(authContextMiddleware);
  identityAccessRouter.use(identityAccessAuthRouter);
  identityAccessRouter.use(identityAccessOrganizationsRouter);
  identityAccessRouter.use(identityAccessUsersRouter);
  identityAccessRouter.use(identityAccessAdminOrganizationsRouter);
  // notification-preferences PR3: mounted on the SAME authenticated `/api/v1`
  // router — `notifications` routes are USER-tier self-service and rely on the
  // `authContextMiddleware` above to resolve the caller's AuthContext.
  identityAccessRouter.use(notificationPreferenceRouter({ getNotificationPreferences, setNotificationPreference }));

  const app = createApp({
    routers: [{ path: '/api/v1', router: identityAccessRouter }],
    // Merged status maps: identity-access + notifications closed error codes.
    // The two overlapping keys (INVARIANT_VIOLATION=400, FORBIDDEN_CROSS_TENANT=403)
    // agree, so the spread is order-independent.
    errorHandler: createErrorHandler({ ...identityAccessErrorStatus, ...notificationsErrorStatus }),
    trustProxy: TRUST_PROXY,
  });

  // two-step-login PR1a: visibility into the parsed TTL env contract before
  // any route consumes it (PR1b/PR2 wire BeginUserLogin/IssueSession against
  // these same values).
  console.log(
    `MFA challenge TTLs configured: challenge=${AUTH_MFA_CHALLENGE_TTL_SECONDS}s enrollment=${AUTH_MFA_ENROLLMENT_TTL_SECONDS}s`,
  );

  // super-admin-auth PR1: visibility into the PLATFORM_ADMIN challenge TTL,
  // same precedent as the MFA challenge TTL log above.
  console.log(`Admin challenge TTL configured: ${AUTH_ADMIN_CHALLENGE_TTL_SECONDS}s`);

  // two-step-login PR1b (design D6): make PLATFORM_ADMIN auth availability
  // explicit at startup — a configured, logged state, never a silent 401.
  console.log(
    PLATFORM_ADMIN_AUTH === 'trusted-header'
      ? 'PLATFORM_ADMIN auth: trusted-header (non-prod interim path — forbidden in production)'
      : 'PLATFORM_ADMIN auth: disabled until identity-access-super-admin-auth ships a real admin login',
  );

  app.listen(PORT, () => {
    console.log(`anti-fraud-department listening on port ${PORT}`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exitCode = 1;
});
