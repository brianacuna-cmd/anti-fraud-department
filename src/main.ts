import { Router } from 'express';
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
import { MongoCaseRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { MongoTimelineRecorder } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineRecorder.js';
import { MongoUnitOfWork as CaseManagementMongoUnitOfWork } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { generateCaseId } from './modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from './modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createCreateCaseUseCase } from './modules/case-management/application/CreateCase.js';
import { createCalculateSlaUseCase } from './modules/case-management/application/CalculateSla.js';
import { createRouteCaseUseCase } from './modules/case-management/application/RouteCase.js';
import { createReassignCaseUseCase } from './modules/case-management/application/ReassignCase.js';
import { createListCasesUseCase } from './modules/case-management/application/ListCases.js';
import { createReopenCaseUseCase } from './modules/case-management/application/ReopenCase.js';
import { MongoCaseRoutingRuleRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRoutingRuleRepository.js';
import { MongoOrganizationFraudConfigRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoOrganizationFraudConfigRepository.js';
import { MongoCaseSlaTrackingRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseSlaTrackingRepository.js';
import { ZenRoutingEngine } from './modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { caseRouter } from './modules/case-management/infrastructure/adapters/inbound/http/caseRouter.js';
import { caseManagementErrorStatus } from './modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { createCaseManagementAuditRecorderAdapter } from './composition/caseManagementAuditRecorderAdapter.js';
import { createIdentityAssigneeDirectory } from './composition/identityAssigneeDirectory.js';
import { generateCaseSlaTrackingId } from './modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { createGetOrganizationFraudConfigUseCase } from './modules/case-management/application/GetOrganizationFraudConfig.js';
import { createUpsertOrganizationFraudConfigUseCase } from './modules/case-management/application/UpsertOrganizationFraudConfig.js';
import { createRecordAnalystDecisionUseCase } from './modules/case-management/application/RecordAnalystDecision.js';
import { createApproveEnforcementActionUseCase } from './modules/case-management/application/ApproveEnforcementAction.js';
import { createRejectEnforcementActionUseCase } from './modules/case-management/application/RejectEnforcementAction.js';
import { createExecuteEnforcementActionUseCase } from './modules/case-management/application/ExecuteEnforcementAction.js';
import { createCreateRoutingRuleUseCase } from './modules/case-management/application/CreateRoutingRule.js';
import { createListRoutingRulesUseCase } from './modules/case-management/application/ListRoutingRules.js';
import { createGetRoutingRuleUseCase } from './modules/case-management/application/GetRoutingRule.js';
import { createActivateRoutingRuleUseCase } from './modules/case-management/application/ActivateRoutingRule.js';
import { createDeactivateRoutingRuleUseCase } from './modules/case-management/application/DeactivateRoutingRule.js';
import { organizationFraudConfigRouter } from './modules/case-management/infrastructure/adapters/inbound/http/organizationFraudConfigRouter.js';
import { enforcementRouter } from './modules/case-management/infrastructure/adapters/inbound/http/enforcementRouter.js';
import { routingRuleRouter } from './modules/case-management/infrastructure/adapters/inbound/http/routingRuleRouter.js';
import { MongoAnalystDecisionRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoAnalystDecisionRepository.js';
import { MongoEnforcementActionRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoEnforcementActionRepository.js';
import { MongoApprovalRequestRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoApprovalRequestRepository.js';
import { MongoCustomerOutgoingEventRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCustomerOutgoingEventRepository.js';
import { HttpOutgoingWebhookClient } from './modules/case-management/infrastructure/adapters/outbound/http/HttpOutgoingWebhookClient.js';
import { createCustomerOutgoingEventDispatcher } from './modules/case-management/infrastructure/adapters/outbound/CustomerOutgoingEventDispatcher.js';
import { generateAnalystDecisionId } from './modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { generateEnforcementActionId } from './modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { generateApprovalRequestId } from './modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { generateCustomerOutgoingEventId } from './modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { generateCaseRoutingRuleId } from './modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { MongoRiskScoringRuleRepository } from './modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoRiskScoringRuleRepository.js';
import { MongoUnitOfWork as RiskAssessmentMongoUnitOfWork } from './modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { ZenRiskScoringEngine } from './modules/risk-assessment/infrastructure/adapters/outbound/zen/ZenRiskScoringEngine.js';
import { createCalculateRiskScoreUseCase } from './modules/risk-assessment/application/CalculateRiskScore.js';
import { createCreateScoringRuleUseCase } from './modules/risk-assessment/application/CreateScoringRule.js';
import { createActivateScoringRuleUseCase } from './modules/risk-assessment/application/ActivateScoringRule.js';
import { createListScoringRulesUseCase } from './modules/risk-assessment/application/ListScoringRules.js';
import { createGetScoringRuleUseCase } from './modules/risk-assessment/application/GetScoringRule.js';
import { generateRiskScoringRuleId } from './modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { riskScoreRouter } from './modules/risk-assessment/infrastructure/adapters/inbound/http/riskScoreRouter.js';
import { scoringRuleRouter } from './modules/risk-assessment/infrastructure/adapters/inbound/http/scoringRuleRouter.js';
import { riskAssessmentErrorStatus } from './modules/risk-assessment/infrastructure/adapters/inbound/http/errorStatus.js';
import { createRiskAssessmentAuditRecorderAdapter } from './composition/riskAssessmentAuditRecorderAdapter.js';
import { createScoreToCaseOrchestrator } from './composition/scoreToCaseOrchestrator.js';
import { scoreToCaseProcessRouter } from './composition/scoreToCaseProcessRouter.js';
import { createWebhookToScoreOrchestrator } from './composition/webhookToScoreOrchestrator.js';
import { createReceiveProviderWebhookUseCase } from './modules/ingest/application/ReceiveProviderWebhook.js';
import { createUpsertInboundWebhookSecretUseCase } from './modules/ingest/application/UpsertInboundWebhookSecret.js';
import { generateInboundWebhookSecretId } from './modules/ingest/domain/model/value-objects/InboundWebhookSecretId.js';
import { ingestErrorStatus } from './modules/ingest/infrastructure/adapters/inbound/http/errorStatus.js';
import { inboundWebhookSecretRouter } from './modules/ingest/infrastructure/adapters/inbound/http/inboundWebhookSecretRouter.js';
import { webhookRouter } from './modules/ingest/infrastructure/adapters/inbound/http/webhookRouter.js';
import { selectVerifier } from './modules/ingest/infrastructure/adapters/outbound/crypto/selectVerifier.js';
import { mapProviderEnvelope } from './modules/ingest/infrastructure/adapters/outbound/mapping/mapProviderEnvelope.js';
import { MongoInboundWebhookSecretRepository } from './modules/ingest/infrastructure/adapters/outbound/mongo/MongoInboundWebhookSecretRepository.js';
import { MongoProviderIngestEventRepository } from './modules/ingest/infrastructure/adapters/outbound/mongo/MongoProviderIngestEventRepository.js';

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
/** Poll interval for customer_outgoing_events webhook dispatcher (PR5). */
const OUTGOING_WEBHOOK_DISPATCHER_INTERVAL_MS = Number(
  process.env.OUTGOING_WEBHOOK_DISPATCHER_INTERVAL_MS ?? 5000,
);

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

  // case-management Slice 5 (T5 manual case creation): own `MongoUnitOfWork`
  // instance (same pattern as `notificationsUnitOfWork` above) so the Case
  // insert + CaseTimeline CASE_CREATED entry + CREATE_CASE audit row commit
  // atomically. Its `AuditRecorder` bridges to the SAME `recordAuditLog`
  // instance via its OWN composition-root adapter (nominally distinct port,
  // exact twin of `auditRecorderAdapter.ts`/`notificationsAuditRecorderAdapter.ts`).
  const caseManagementUnitOfWork = new CaseManagementMongoUnitOfWork(client);
  const cases = new MongoCaseRepository(db);
  const caseTimelineRecorder = new MongoTimelineRecorder(db);
  const caseManagementAuditRecorder = createCaseManagementAuditRecorderAdapter(recordAuditLog);
  // CASE-002 (T1 auto-routing): ACTIVE routing rules are evaluated by the ZEN
  // engine on every case creation. The composed `RouteCase` use case is injected
  // into `CreateCase` so its assignment + ASSIGNED timeline event commit inside
  // the same transaction as the new case. `fraudConfig` backs the per-tenant
  // `featureFlags.autoRouting` opt-out.
  const caseRoutingRules = new MongoCaseRoutingRuleRepository(db);
  const caseRoutingEngine = new ZenRoutingEngine();
  const organizationFraudConfig = new MongoOrganizationFraudConfigRepository(db);
  const caseSlaTracking = new MongoCaseSlaTrackingRepository(db);
  const routeCase = createRouteCaseUseCase({
    cases,
    routingRules: caseRoutingRules,
    routingEngine: caseRoutingEngine,
    timelineRecorder: caseTimelineRecorder,
    auditRecorder: caseManagementAuditRecorder,
    fraudConfig: organizationFraudConfig,
    clock,
    generateTimelineEventId,
  });
  const calculateSla = createCalculateSlaUseCase({
    cases,
    slaTracking: caseSlaTracking,
    fraudConfig: organizationFraudConfig,
    clock,
    generateCaseSlaTrackingId,
  });
  const assigneeDirectory = createIdentityAssigneeDirectory(userRepositoryFactory, roleRepository);
  const createCase = createCreateCaseUseCase({
    cases,
    timelineRecorder: caseTimelineRecorder,
    unitOfWork: caseManagementUnitOfWork,
    clock,
    generateCaseId,
    generateTimelineEventId,
    auditRecorder: caseManagementAuditRecorder,
    routeCase,
    calculateSla,
  });
  const getOrganizationFraudConfig = createGetOrganizationFraudConfigUseCase({
    repository: organizationFraudConfig,
  });
  const caseManagementCasesRouter = caseRouter({
    createCase,
    reassignCase: createReassignCaseUseCase({
      cases,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateTimelineEventId,
      assigneeDirectory,
    }),
    listCases: createListCasesUseCase({ cases }),
    reopenCase: createReopenCaseUseCase({
      cases,
      slaTracking: caseSlaTracking,
      fraudConfig: organizationFraudConfig,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateTimelineEventId,
      generateCaseSlaTrackingId,
    }),
  });
  const organizationFraudConfigHttpRouter = organizationFraudConfigRouter({
    getOrganizationFraudConfig,
    upsertOrganizationFraudConfig: createUpsertOrganizationFraudConfigUseCase({
      repository: organizationFraudConfig,
      clock,
    }),
  });
  const analystDecisions = new MongoAnalystDecisionRepository(db);
  const enforcementActions = new MongoEnforcementActionRepository(db);
  const approvalRequests = new MongoApprovalRequestRepository(db);
  const customerOutgoingEvents = new MongoCustomerOutgoingEventRepository(db);
  const outgoingWebhookClient = new HttpOutgoingWebhookClient();
  const customerOutgoingEventDispatcher = createCustomerOutgoingEventDispatcher({
    outgoingEvents: customerOutgoingEvents,
    webhookClient: outgoingWebhookClient,
    clock,
  });
  const enforcementHttpRouter = enforcementRouter({
    recordAnalystDecision: createRecordAnalystDecisionUseCase({
      cases,
      decisions: analystDecisions,
      enforcementActions,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateAnalystDecisionId,
      generateEnforcementActionId,
      generateTimelineEventId,
    }),
    approveEnforcementAction: createApproveEnforcementActionUseCase({
      enforcementActions,
      approvalRequests,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateApprovalRequestId,
    }),
    rejectEnforcementAction: createRejectEnforcementActionUseCase({
      enforcementActions,
      approvalRequests,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateApprovalRequestId,
    }),
    executeEnforcementAction: createExecuteEnforcementActionUseCase({
      enforcementActions,
      outgoingEvents: customerOutgoingEvents,
      cases,
      fraudConfig: organizationFraudConfig,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateCustomerOutgoingEventId,
    }),
  });
  const routingRuleHttpRouter = routingRuleRouter({
    createRoutingRule: createCreateRoutingRuleUseCase({
      routingRules: caseRoutingRules,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateCaseRoutingRuleId,
    }),
    listRoutingRules: createListRoutingRulesUseCase({ routingRules: caseRoutingRules }),
    getRoutingRule: createGetRoutingRuleUseCase({ routingRules: caseRoutingRules }),
    activateRoutingRule: createActivateRoutingRuleUseCase({
      routingRules: caseRoutingRules,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
    }),
    deactivateRoutingRule: createDeactivateRoutingRuleUseCase({
      routingRules: caseRoutingRules,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
    }),
  });

  // risk-assessment: standalone CalculateRiskScore + scoring-rule draft/activate API.
  // Not injected into CreateCase — POST /cases still requires a caller-supplied riskScore.
  const scoringRules = new MongoRiskScoringRuleRepository(db);
  const scoringEngine = new ZenRiskScoringEngine();
  const riskAssessmentAuditRecorder = createRiskAssessmentAuditRecorderAdapter(recordAuditLog);
  const riskAssessmentUnitOfWork = new RiskAssessmentMongoUnitOfWork(client);
  const calculateRiskScore = createCalculateRiskScoreUseCase({
    scoringRules,
    scoringEngine,
    auditRecorder: riskAssessmentAuditRecorder,
  });
  const createScoringRule = createCreateScoringRuleUseCase({
    scoringRules,
    auditRecorder: riskAssessmentAuditRecorder,
    clock,
    generateRiskScoringRuleId,
  });
  const activateScoringRule = createActivateScoringRuleUseCase({
    scoringRules,
    unitOfWork: riskAssessmentUnitOfWork,
    auditRecorder: riskAssessmentAuditRecorder,
    clock,
  });
  const listScoringRules = createListScoringRulesUseCase({ scoringRules });
  const getScoringRule = createGetScoringRuleUseCase({ scoringRules });
  const riskScoresRouter = riskScoreRouter({ calculateRiskScore });
  const riskScoringRulesRouter = scoringRuleRouter({
    createScoringRule,
    activateScoringRule,
    listScoringRules,
    getScoringRule,
  });
  // Composition-only score→threshold→CreateCase path (eslint boundaries).
  const processRiskScoreToCase = createScoreToCaseOrchestrator({
    calculateRiskScore,
    getOrganizationFraudConfig,
    createCase,
  });
  const riskScoreProcessRouter = scoreToCaseProcessRouter({ processRiskScoreToCase });

  // provider-risk-ingest PR5b: webhook mount is not JWT. Same AesGcmSecretCipher
  // instance as identity-access (injected — ingest must not import that module).
  const inboundWebhookSecrets = new MongoInboundWebhookSecretRepository(db);
  const providerIngestEvents = new MongoProviderIngestEventRepository(db);
  const webhookToScore = createWebhookToScoreOrchestrator({
    processRiskScoreToCase,
    events: providerIngestEvents,
    clock,
  });
  const receiveProviderWebhook = createReceiveProviderWebhookUseCase({
    secrets: inboundWebhookSecrets,
    events: providerIngestEvents,
    cipher: secretCipher,
    verifiers: selectVerifier,
    mapper: { map: mapProviderEnvelope },
    composer: webhookToScore,
    clock,
  });
  const ingestWebhookRouter = webhookRouter({ receiveProviderWebhook });
  const upsertInboundWebhookSecret = createUpsertInboundWebhookSecretUseCase({
    secrets: inboundWebhookSecrets,
    cipher: secretCipher,
    clock,
    generateInboundWebhookSecretId,
  });
  const inboundWebhookSecretHttpRouter = inboundWebhookSecretRouter({ upsertInboundWebhookSecret });

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
  // case-management Slice 5 + T2: cases + organization fraud config mounted
  // on the SAME authenticated `/api/v1` router — rely on
  // `authContextMiddleware` above to resolve the caller's AuthContext.
  identityAccessRouter.use(caseManagementCasesRouter);
  identityAccessRouter.use(organizationFraudConfigHttpRouter);
  identityAccessRouter.use(enforcementHttpRouter);
  identityAccessRouter.use(routingRuleHttpRouter);
  identityAccessRouter.use(riskScoresRouter);
  identityAccessRouter.use(riskScoreProcessRouter);
  identityAccessRouter.use(riskScoringRulesRouter);
  identityAccessRouter.use(inboundWebhookSecretHttpRouter);

  const app = createApp({
    routers: [{ path: '/api/v1', router: identityAccessRouter }],
    webhookRouters: [{ path: '/webhooks', router: ingestWebhookRouter }],
    // Merged status maps: identity-access + notifications + case-management
    // + risk-assessment + ingest closed error codes. Overlapping keys
    // (INVARIANT_VIOLATION=400, FORBIDDEN_CROSS_TENANT=403) agree, so the
    // spread is order-independent.
    errorHandler: createErrorHandler({
      ...identityAccessErrorStatus,
      ...notificationsErrorStatus,
      ...caseManagementErrorStatus,
      ...riskAssessmentErrorStatus,
      ...ingestErrorStatus,
    }),
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

  customerOutgoingEventDispatcher.start(OUTGOING_WEBHOOK_DISPATCHER_INTERVAL_MS);
  console.log(
    `Customer outgoing webhook dispatcher started (interval=${OUTGOING_WEBHOOK_DISPATCHER_INTERVAL_MS}ms)`,
  );

  app.listen(PORT, () => {
    console.log(`anti-fraud-department listening on port ${PORT}`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exitCode = 1;
});
