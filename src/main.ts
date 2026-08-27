import { Router } from 'express';
import { createApp } from './shared/http/createApp.js';
import { parseTrustProxy } from './shared/http/parseTrustProxy.js';
import { createErrorHandler } from './shared/http/errorHandler.js';
import { connectMongo } from './shared/persistence/mongo/connect.js';
import { ensureIndexes } from './shared/persistence/mongo/ensureIndexes.js';
import { ensureRoles } from './shared/persistence/mongo/ensureRoles.js';
import { SystemClock } from './shared/time/SystemClock.js';
import { generateObjectIdHex } from './shared/kernel/ObjectIdHex.js';
import { identityAccessErrorStatus } from './modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';
import { organizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/organizationRouter.js';
import { userRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/userRouter.js';
import { adminOrganizationRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/adminOrganizationRouter.js';
import { authRouter } from './modules/identity-access/infrastructure/adapters/inbound/http/authRouter.js';
import {
  assertAuthConfigSafeForProduction,
  DEV_TOKEN_SECRET,
} from './modules/identity-access/infrastructure/adapters/inbound/http/auth/assertAuthConfigSafeForProduction.js';
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
import { createCaseManagementNotificationSenderAdapter } from './composition/caseManagementNotificationSenderAdapter.js';
import { createNotificationEmailSenderAdapter } from './composition/notificationEmailSenderAdapter.js';
import { MongoNotificationPreferenceRepository } from './modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationPreferenceRepository.js';
import { MongoNotificationRepository } from './modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationRepository.js';
import { createSendNotificationUseCase } from './modules/notifications/application/SendNotification.js';
import { generateNotificationId } from './modules/notifications/domain/model/value-objects/NotificationId.js';
import { MongoUnitOfWork as NotificationsMongoUnitOfWork } from './modules/notifications/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createGetNotificationPreferencesUseCase } from './modules/notifications/application/GetNotificationPreferences.js';
import { createSetNotificationPreferenceUseCase } from './modules/notifications/application/SetNotificationPreference.js';
import { notificationPreferenceRouter } from './modules/notifications/infrastructure/adapters/inbound/http/notificationPreferenceRouter.js';
import { notificationsErrorStatus } from './modules/notifications/infrastructure/adapters/inbound/http/errorStatus.js';
import { MongoCaseRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { MongoTimelineRecorder } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineRecorder.js';
import { MongoTimelineReader } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineReader.js';
import { MongoCaseNoteRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseNoteRepository.js';
import { MongoResolutionRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoResolutionRepository.js';
import { MongoOutboxEventRepository } from './shared/outbox/mongo/MongoOutboxEventRepository.js';
import { MongoInvestigationRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoInvestigationRepository.js';
import { MongoCaseReportRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseReportRepository.js';
import { MongoEvidenceRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoEvidenceRepository.js';
import { FilesystemEvidenceStore } from './modules/case-management/infrastructure/adapters/outbound/storage/FilesystemEvidenceStore.js';
import { S3EvidenceStore } from './modules/case-management/infrastructure/adapters/outbound/storage/S3EvidenceStore.js';
import { Rfc3161TimestampAuthority } from './modules/case-management/infrastructure/adapters/outbound/timestamp/Rfc3161TimestampAuthority.js';
import { ClamAvMalwareScanner } from './modules/case-management/infrastructure/adapters/outbound/antivirus/ClamAvMalwareScanner.js';
import { DisabledMalwareScanner } from './modules/case-management/infrastructure/adapters/outbound/antivirus/DisabledMalwareScanner.js';
import { createGenerateCaseAuditDossierUseCase } from './modules/case-management/application/GenerateCaseAuditDossier.js';
import { createCreateEvidenceDownloadUrlUseCase } from './modules/case-management/application/CreateEvidenceDownloadUrl.js';
import { CaseReportPdfRenderer } from './modules/case-management/infrastructure/adapters/inbound/http/report/CaseReportPdfRenderer.js';
import type { EvidenceStore } from './modules/case-management/domain/ports/EvidenceStore.js';
import type { TimestampAuthority } from './modules/case-management/domain/ports/TimestampAuthority.js';
import type { MalwareScanner } from './modules/case-management/domain/ports/MalwareScanner.js';
import { NullTimestampAuthority } from './modules/case-management/infrastructure/adapters/outbound/timestamp/NullTimestampAuthority.js';
import { MongoUnitOfWork as CaseManagementMongoUnitOfWork } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { generateCaseId } from './modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from './modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createCreateCaseUseCase } from './modules/case-management/application/CreateCase.js';
import { createCalculateSlaUseCase } from './modules/case-management/application/CalculateSla.js';
import { createRouteCaseUseCase } from './modules/case-management/application/RouteCase.js';
import { createReassignCaseUseCase } from './modules/case-management/application/ReassignCase.js';
import { createListCasesUseCase } from './modules/case-management/application/ListCases.js';
import { createExportCasesUseCase } from './modules/case-management/application/ExportCases.js';
import { createGetFraudMetricsUseCase } from './modules/case-management/application/GetFraudMetrics.js';
import { createReopenCaseUseCase } from './modules/case-management/application/ReopenCase.js';
import { createUpdateCasePriorityTagsUseCase } from './modules/case-management/application/UpdateCasePriorityTags.js';
import { createBulkCaseActionUseCase } from './modules/case-management/application/BulkCaseAction.js';
import { createGetCaseUseCase } from './modules/case-management/application/GetCase.js';
import { createGetCaseTimelineUseCase } from './modules/case-management/application/GetCaseTimeline.js';
import { createAddCaseNoteUseCase } from './modules/case-management/application/AddCaseNote.js';
import { createListCaseNotesUseCase } from './modules/case-management/application/ListCaseNotes.js';
import { generateCaseNoteId } from './modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createResolveCaseUseCase } from './modules/case-management/application/ResolveCase.js';
import { createArchiveCaseUseCase } from './modules/case-management/application/ArchiveCase.js';
import { createStartReviewUseCase } from './modules/case-management/application/StartReview.js';
import { createOpenInvestigationUseCase } from './modules/case-management/application/OpenInvestigation.js';
import { createListInvestigationsUseCase } from './modules/case-management/application/ListInvestigations.js';
import { createGetInvestigationUseCase } from './modules/case-management/application/GetInvestigation.js';
import { createBuildEntityNetworkGraphUseCase } from './modules/case-management/application/BuildEntityNetworkGraph.js';
import { createExportInvestigationUseCase } from './modules/case-management/application/ExportInvestigation.js';
import { createExportInvestigationSummaryUseCase } from './modules/case-management/application/ExportInvestigationSummary.js';
import { createCloseInvestigationUseCase } from './modules/case-management/application/CloseInvestigation.js';
import { createUpdateInvestigationFindingsUseCase } from './modules/case-management/application/UpdateInvestigationFindings.js';
import { createLinkInvestigationCasesUseCase } from './modules/case-management/application/LinkInvestigationCases.js';
import { createListActiveInvestigationsUseCase } from './modules/case-management/application/ListActiveInvestigations.js';
import { createUpdateInvestigationStatusUseCase } from './modules/case-management/application/UpdateInvestigationStatus.js';
import { generateInvestigationId } from './modules/case-management/domain/model/value-objects/InvestigationId.js';
import { investigationRouter } from './modules/case-management/infrastructure/adapters/inbound/http/investigationRouter.js';
import { createResolveToReportOrchestrator } from './composition/resolveToReportOrchestrator.js';
import { createGenerateCaseReportUseCase } from './modules/case-management/application/GenerateCaseReport.js';
import { createListCaseReportsUseCase } from './modules/case-management/application/ListCaseReports.js';
import { createGetCaseReportUseCase } from './modules/case-management/application/GetCaseReport.js';
import { generateCaseReportId } from './modules/case-management/domain/model/value-objects/CaseReportId.js';
import { reportRouter } from './modules/case-management/infrastructure/adapters/inbound/http/reportRouter.js';
import { createRegisterEvidenceUseCase } from './modules/case-management/application/RegisterEvidence.js';
import { createListEvidenceUseCase } from './modules/case-management/application/ListEvidence.js';
import { createGetEvidenceUseCase } from './modules/case-management/application/GetEvidence.js';
import { createDownloadEvidenceUseCase } from './modules/case-management/application/DownloadEvidence.js';
import { createDeleteEvidenceUseCase } from './modules/case-management/application/DeleteEvidence.js';
import { createDeleteCaseNoteUseCase } from './modules/case-management/application/DeleteCaseNote.js';
import { generateEvidenceId } from './modules/case-management/domain/model/value-objects/EvidenceId.js';
import { evidenceRouter } from './modules/case-management/infrastructure/adapters/inbound/http/evidenceRouter.js';
import { noteRouter } from './modules/case-management/infrastructure/adapters/inbound/http/noteRouter.js';
import { generateResolutionId } from './modules/case-management/domain/model/value-objects/ResolutionId.js';
import { generateOutboxEventId } from './shared/outbox/OutboxEventId.js';
import { createSweepSlaTrackingUseCase } from './modules/case-management/application/SweepSlaTracking.js';
import { createSlaSweepScheduler } from './modules/case-management/infrastructure/scheduler/SlaSweepScheduler.js';
import { MongoCaseRoutingRuleRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRoutingRuleRepository.js';
import { MongoOrganizationFraudConfigRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoOrganizationFraudConfigRepository.js';
import { MongoCaseSlaTrackingRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseSlaTrackingRepository.js';
import { ZenRoutingEngine } from './modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { createSimulateRoutingRuleUseCase } from './modules/case-management/application/SimulateRoutingRule.js';
import { caseRouter } from './modules/case-management/infrastructure/adapters/inbound/http/caseRouter.js';
import { caseExportRouter } from './modules/case-management/infrastructure/adapters/inbound/http/caseExportRouter.js';
import { metricsRouter } from './modules/case-management/infrastructure/adapters/inbound/http/metricsRouter.js';
import { MongoFraudMetricsReader } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoFraudMetricsReader.js';
// Integracion Finturu (propia de este fork): ingesta por webhook, padron de
// clientes y consultas en vivo a los proveedores.
import { createIngestFinturuCaseUseCase } from './modules/case-management/application/IngestFinturuCase.js';
import { createInitializeCaseSlaService } from './modules/case-management/application/InitializeCaseSla.js';
import { createSyncFinturuDataUseCase } from './modules/case-management/application/SyncFinturuData.js';
import { createGetFinturuDirectoryUseCase } from './modules/case-management/application/GetFinturuDirectory.js';
import { createSyncFinturuDirectoryUseCase } from './modules/case-management/application/SyncFinturuDirectory.js';
import { DirectorySyncScheduler } from './modules/case-management/application/DirectorySyncScheduler.js';
import { createOpenFraudCaseUseCase } from './modules/case-management/application/OpenFraudCaseFromCustomer.js';
import {
  createLogOutboxPublisher,
  createPublishOutboxEventsUseCase,
} from './modules/case-management/application/PublishOutboxEvents.js';
import { FinturuApiClient } from './modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import { MongoFinturuDirectoryRepository } from './modules/case-management/infrastructure/adapters/outbound/mongo/MongoFinturuDirectoryRepository.js';
import { createOutboxPublishScheduler } from './modules/case-management/infrastructure/scheduler/OutboxPublishScheduler.js';
import { finturuRouter } from './modules/case-management/infrastructure/adapters/inbound/http/finturuRouter.js';
import { finturuWebhookRouter } from './modules/case-management/infrastructure/adapters/inbound/http/finturuWebhookRouter.js';
import { caseManagementErrorStatus } from './modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { createCaseManagementAuditRecorderAdapter } from './composition/caseManagementAuditRecorderAdapter.js';
import { createScreeningAuditRecorderAdapter } from './composition/screeningAuditRecorderAdapter.js';
import { createIdentityAssigneeDirectory } from './composition/identityAssigneeDirectory.js';
import { generateCaseSlaTrackingId } from './modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { createGetOrganizationFraudConfigUseCase } from './modules/case-management/application/GetOrganizationFraudConfig.js';
import { createUpsertOrganizationFraudConfigUseCase } from './modules/case-management/application/UpsertOrganizationFraudConfig.js';
import { createRecordAnalystDecisionUseCase } from './modules/case-management/application/RecordAnalystDecision.js';
import { createRequestEnforcementActionUseCase } from './modules/case-management/application/RequestEnforcementAction.js';
import { createListCaseDecisionsUseCase } from './modules/case-management/application/ListCaseDecisions.js';
import { createApproveEnforcementActionUseCase } from './modules/case-management/application/ApproveEnforcementAction.js';
import { createRejectEnforcementActionUseCase } from './modules/case-management/application/RejectEnforcementAction.js';
import { createExecuteEnforcementActionUseCase } from './modules/case-management/application/ExecuteEnforcementAction.js';
import { createRevertEnforcementActionUseCase } from './modules/case-management/application/RevertEnforcementAction.js';
import { createListEnforcementActionsUseCase } from './modules/case-management/application/ListEnforcementActions.js';
import { createCreateRoutingRuleUseCase } from './modules/case-management/application/CreateRoutingRule.js';
import { createListRoutingRulesUseCase } from './modules/case-management/application/ListRoutingRules.js';
import { createGetRoutingRuleUseCase } from './modules/case-management/application/GetRoutingRule.js';
import { createActivateRoutingRuleUseCase } from './modules/case-management/application/ActivateRoutingRule.js';
import { createDeactivateRoutingRuleUseCase } from './modules/case-management/application/DeactivateRoutingRule.js';
import { organizationFraudConfigRouter } from './modules/case-management/infrastructure/adapters/inbound/http/organizationFraudConfigRouter.js';
import { enforcementRouter } from './modules/case-management/infrastructure/adapters/inbound/http/enforcementRouter.js';
import { approvalRequestRouter } from './modules/case-management/infrastructure/adapters/inbound/http/approvalRequestRouter.js';
import { createReviewApprovalRequestUseCase } from './modules/case-management/application/ReviewApprovalRequest.js';
import { createListApprovalRequestsUseCase } from './modules/case-management/application/ListApprovalRequests.js';
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
import { createSimulateScoringRuleUseCase } from './modules/risk-assessment/application/SimulateScoringRule.js';
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
import type { ScoreToCaseOrchestratorInput, ScoreToCaseOrchestratorResult } from './composition/scoreToCaseOrchestrator.js';
import { scoreToCaseProcessRouter } from './composition/scoreToCaseProcessRouter.js';
import { createWebhookToScoreOrchestrator } from './composition/webhookToScoreOrchestrator.js';
import { createScreenThenScoreToCaseOrchestrator } from './composition/screenThenScoreToCaseOrchestrator.js';
import type { CanonicalRiskEvent } from './modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import { createScreenSubjectAgainstWatchlistUseCase } from './modules/screening/application/ScreenSubjectAgainstWatchlist.js';
import type { ScreenSubjectAgainstWatchlistInput } from './modules/screening/application/ScreenSubjectAgainstWatchlist.js';
import { createOpenAmlAlertUseCase } from './modules/screening/application/OpenAmlAlert.js';
import { createListAmlAlertsUseCase } from './modules/screening/application/ListAmlAlerts.js';
import { createGetAmlAlertUseCase } from './modules/screening/application/GetAmlAlert.js';
import { createGetAmlAlertTimelineUseCase } from './modules/screening/application/GetAmlAlertTimeline.js';
import { createTransitionAmlAlertUseCase } from './modules/screening/application/TransitionAmlAlert.js';
import { createEscalateAmlAlertUseCase } from './modules/screening/application/EscalateAmlAlert.js';
import { createResolveAmlAlertUseCase } from './modules/screening/application/ResolveAmlAlert.js';
import { amlAlertRouter } from './modules/screening/infrastructure/adapters/inbound/http/amlAlertRouter.js';
import { screeningErrorStatus } from './modules/screening/infrastructure/adapters/inbound/http/errorStatus.js';
import { createAmlAlertCaseOpener } from './composition/amlAlertCaseOpener.js';
import { generateAmlAlertId } from './modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createEntryType, isEntryType } from './modules/screening/domain/model/value-objects/EntryType.js';
import { MongoAmlAlertRepository } from './modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlAlertRepository.js';
import { MongoAmlExpedienteTimelineRecorder } from './modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlExpedienteTimelineRecorder.js';
import { MongoUnitOfWork as ScreeningMongoUnitOfWork } from './modules/screening/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoFallbackWatchlistCandidateRepository } from './modules/screening/infrastructure/adapters/outbound/mongo/MongoFallbackWatchlistCandidateRepository.js';
import { MongoAtlasWatchlistCandidateRepository } from './modules/screening/infrastructure/adapters/outbound/mongo/MongoAtlasWatchlistCandidateRepository.js';
import { TalismanPhoneticEncoder } from './modules/screening/infrastructure/adapters/outbound/matching/TalismanPhoneticEncoder.js';
import { TalismanSimilarityCalculator } from './modules/screening/infrastructure/adapters/outbound/matching/TalismanSimilarityCalculator.js';
import { MongoOrganizationScreeningConfigRepository } from './modules/screening/infrastructure/adapters/outbound/mongo/MongoOrganizationScreeningConfigRepository.js';
import { createGetOrganizationScreeningConfigUseCase } from './modules/screening/application/GetOrganizationScreeningConfig.js';
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
// NOSONAR (S2068): `DEV_TOKEN_SECRET` no es una credencial, es el valor
// por defecto de desarrollo. `assertAuthConfigSafeForProduction` aborta el
// arranque si sigue puesto con NODE_ENV=production, asi que no puede llegar
// a un despliegue real.
const TOKEN_SECRET = process.env.TOKEN_SECRET ?? DEV_TOKEN_SECRET; // NOSONAR
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
const NOTIFICATION_EMAIL_FROM = process.env.NOTIFICATION_EMAIL_FROM ?? PASSWORD_RESET_EMAIL_FROM;
const EVIDENCE_STORAGE_DIR = process.env.EVIDENCE_STORAGE_DIR ?? './.evidence';
/**
 * Almacen de evidencias. `EVIDENCE_S3_BUCKET` presente = S3 (INV-002/004);
 * ausente = filesystem local, que sirve en desarrollo pero NO sabe emitir URLs
 * prefirmadas. Las credenciales no se leen aqui: las resuelve la cadena por
 * defecto del SDK (rol de la instancia, perfil, entorno).
 */
/**
 * Variable opcional que ACTIVA una función cuando está presente.
 *
 * Trata la cadena vacía como ausente. `TSA_URL=` en un `.env` produce `''`,
 * que no es `undefined`, así que un simple `process.env.X` encendía la función
 * con una URL vacía y fallaba en tiempo de ejecución en vez de quedarse
 * apagada. Quien deja la variable en blanco está diciendo «esto no», no
 * «esto, con el valor vacío».
 */
function optionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

const EVIDENCE_S3_BUCKET = optionalEnv('EVIDENCE_S3_BUCKET');
const EVIDENCE_S3_REGION = process.env.EVIDENCE_S3_REGION ?? 'us-east-1';
const EVIDENCE_S3_PREFIX = optionalEnv('EVIDENCE_S3_PREFIX');
const EVIDENCE_S3_ENDPOINT = optionalEnv('EVIDENCE_S3_ENDPOINT');
/**
 * TSA RFC 3161 (INV-003). Sin `TSA_URL` no se sella: la evidencia se registra
 * igual con su SHA-256, pero sin sello de tiempo oponible a un tercero.
 */
const TSA_URL = optionalEnv('TSA_URL');
const TSA_AUTHORITY_NAME = optionalEnv('TSA_AUTHORITY_NAME') ?? TSA_URL ?? 'unknown';
/**
 * Antivirus (INV-015). Sin `CLAMAV_HOST` los ficheros se marcan SKIPPED — que
 * es lo que de verdad ocurrio— en vez de CLEAN.
 */
const CLAMAV_HOST = optionalEnv('CLAMAV_HOST');
const CLAMAV_PORT = Number(process.env.CLAMAV_PORT ?? 3310);
const PASSWORD_RESET_LINK_BASE_URL = process.env.PASSWORD_RESET_LINK_BASE_URL ?? 'http://localhost:3000/reset-password';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
/** Poll interval for customer_outgoing_events webhook dispatcher (PR5). */
const OUTGOING_WEBHOOK_DISPATCHER_INTERVAL_MS = Number(
  process.env.OUTGOING_WEBHOOK_DISPATCHER_INTERVAL_MS ?? 5000,
);
/**
 * Poll interval for the background SLA sweep (casemgmt-notifications-sla-sweep
 * PR2, Slice 13). SINGLE-INSTANCE CAVEAT: see `SlaSweepScheduler.ts` header —
 * running more than one instance of this process races multiple sweep loops
 * against the same due rows; `markNotified` idempotency is the only guard.
 */
const SLA_SWEEP_INTERVAL_MS = Number(process.env.SLA_SWEEP_INTERVAL_MS ?? 60_000);
const OUTBOX_PUBLISH_INTERVAL_MS = Number(process.env.OUTBOX_PUBLISH_INTERVAL_MS ?? 60_000);
/**
 * screening-watchlist-matcher Slice 7 (design "KEY DECISION — Atlas Search
 * testability"): selects the blocking-layer candidate adapter.
 * `SCREENING_MATCH_BACKEND=atlas` wires the staging/prod
 * `MongoAtlasWatchlistCandidateRepository` ($search); anything else
 * (default, including unset — CI/test-safe) wires the
 * `MongoFallbackWatchlistCandidateRepository` (plain compound/regex index,
 * mongodb-memory-server-compatible). Feature-flagged/reversible per the
 * design's migration plan — revert = leave this env unset.
 */
const SCREENING_MATCH_BACKEND = process.env.SCREENING_MATCH_BACKEND ?? 'index';

async function bootstrap(): Promise<void> {
  // Fail-closed (design D4, D6): AUTH_MODE=trusted-header trusts client
  // headers verbatim and must never run in production; PLATFORM_ADMIN_AUTH=
  // trusted-header is likewise production-forbidden for every tier.
  assertAuthConfigSafeForProduction(
    process.env.NODE_ENV,
    AUTH_MODE,
    PLATFORM_ADMIN_AUTH,
    process.env.TOKEN_SECRET,
  );

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

  // casemgmt-notifications-sla-sweep PR1 (Slice 10.5): `SendNotification`
  // persists an in-app row for a machine-to-machine trigger (no
  // `AuthContext` — consults `notificationPreferences.findOne` directly,
  // design ADR-D3). `caseManagementNotificationSenderAdapter` bridges
  // case-management's OWN `NotificationSender` port to this use case (exact
  // twin of `caseManagementAuditRecorderAdapter`), so notifications commit
  // atomically with the triggering case-management transaction.
  const notifications = new MongoNotificationRepository(db);
  const notificationEmailSender = createNotificationEmailSenderAdapter(
    emailSender,
    userRepositoryFactory,
    NOTIFICATION_EMAIL_FROM,
  );
  const sendNotification = createSendNotificationUseCase({
    notifications,
    preferences: notificationPreferences,
    clock,
    generateNotificationId,
    emailSender: notificationEmailSender,
    onEmailError: (error) => {
      console.error('Notification email delivery failed:', error);
    },
  });
  const caseManagementNotificationSender = createCaseManagementNotificationSenderAdapter(sendNotification);

  // case-management Slice 5 (T5 manual case creation): own `MongoUnitOfWork`
  // instance (same pattern as `notificationsUnitOfWork` above) so the Case
  // insert + CaseTimeline CASE_CREATED entry + CREATE_CASE audit row commit
  // atomically. Its `AuditRecorder` bridges to the SAME `recordAuditLog`
  // instance via its OWN composition-root adapter (nominally distinct port,
  // exact twin of `auditRecorderAdapter.ts`/`notificationsAuditRecorderAdapter.ts`).
  const caseManagementUnitOfWork = new CaseManagementMongoUnitOfWork(client);
  const cases = new MongoCaseRepository(db);
  const caseTimelineRecorder = new MongoTimelineRecorder(db);
  const caseTimelineReader = new MongoTimelineReader(db);
  const caseNotes = new MongoCaseNoteRepository(db);
  const resolutions = new MongoResolutionRepository(db);
  const outboxEvents = new MongoOutboxEventRepository(db);
  const investigations = new MongoInvestigationRepository(db);
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
  const caseReports = new MongoCaseReportRepository(db);
  // Suben aqui, con el resto de repositorios: `GenerateCaseReport` los
  // necesita para congelar la evidencia y las aprobaciones, y se cablea
  // antes que los routers que los usaban originalmente.
  const evidence = new MongoEvidenceRepository(db);
  const approvalRequests = new MongoApprovalRequestRepository(db);
  const analystDecisions = new MongoAnalystDecisionRepository(db);
  const enforcementActions = new MongoEnforcementActionRepository(db);
  // Sube aquí porque `routeCase` la necesita para descartar reglas que
  // reparten a quien no instruye; antes se declaraba justo antes de
  // `createCase`, que ya es demasiado tarde.
  const assigneeDirectory = createIdentityAssigneeDirectory(userRepositoryFactory, roleRepository);

  const routeCase = createRouteCaseUseCase({
    cases,
    routingRules: caseRoutingRules,
    routingEngine: caseRoutingEngine,
    timelineRecorder: caseTimelineRecorder,
    auditRecorder: caseManagementAuditRecorder,
    fraudConfig: organizationFraudConfig,
    assigneeDirectory,
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
  // ---------------------------------------------------------------------
  // Integracion Finturu (propia de este fork).
  //
  // `initializeCaseSla` es el gemelo de `calculateSla` para las vias que
  // necesitan la fecha limite ANTES de construir el agregado (la ingesta crea
  // el caso ya con `dueDate` en un solo `save`). Escribe el mismo
  // `CaseSlaTracking` sobre el mismo repositorio, asi que ambas vias dejan los
  // mismos datos.
  // ---------------------------------------------------------------------
  const initializeCaseSla = createInitializeCaseSlaService({
    slaTracking: caseSlaTracking,
    fraudConfig: organizationFraudConfig,
    generateCaseSlaTrackingId,
  });

  const ingestFinturuCase = createIngestFinturuCaseUseCase({
    cases,
    timelineRecorder: caseTimelineRecorder,
    outbox: outboxEvents,
    unitOfWork: caseManagementUnitOfWork,
    clock,
    generateCaseId,
    generateTimelineEventId,
    generateOutboxEventId,
    auditRecorder: caseManagementAuditRecorder,
    initializeCaseSla,
    routeCase,
  });

  const finturuApiClient = new FinturuApiClient({
    baseUrl: process.env.FINTURU_API_URL ?? 'http://localhost:3001',
    encryptionKey: process.env.FRAUD_DEPARTMENT_KEY,
    timeoutMs: Number(process.env.FINTURU_TIMEOUT_MS ?? 10_000),
  });

  const syncFinturuData = createSyncFinturuDataUseCase({
    finturuClient: finturuApiClient,
    ingestFinturuCase,
    defaultOrganizationId: process.env.DEFAULT_ORGANIZATION_ID ?? '019d7e58aed0777318d11d4d',
  });

  // El directorio se sirve desde una copia local: recorrer Bridge en vivo
  // cuesta minutos. `syncFinturuDirectory` la refresca, `getFinturuDirectory`
  // solo lee.
  const finturuDirectory = new MongoFinturuDirectoryRepository(db);

  const getFinturuDirectory = createGetFinturuDirectoryUseCase({
    directory: finturuDirectory,
    cases,
    defaultOrganizationId: process.env.DEFAULT_ORGANIZATION_ID ?? '019d7e58aed0777318d11d4d',
  });

  // Cliente aparte para el sync. `finturuApiClient` corta a los 10 s porque
  // sirve peticiones interactivas, donde rendirse rapido es lo correcto; los
  // listados completos que recorre el sync tardan minutos y necesitan
  // paciencia, no reintentos.
  const finturuSyncClient = new FinturuApiClient({
    baseUrl: process.env.FINTURU_API_URL ?? 'http://localhost:3001',
    encryptionKey: process.env.FRAUD_DEPARTMENT_KEY,
    timeoutMs: Number(process.env.FINTURU_SYNC_TIMEOUT_MS ?? 600_000),
  });

  const syncFinturuDirectory = createSyncFinturuDirectoryUseCase({
    finturuClient: finturuSyncClient,
    directory: finturuDirectory,
    clock,
  });

  const directorySyncScheduler = new DirectorySyncScheduler({
    syncDirectory: syncFinturuDirectory,
    intervalMinutes: Number(process.env.FINTURU_DIRECTORY_SYNC_MINUTES ?? 360),
  });

  const openFraudCase = createOpenFraudCaseUseCase({
    cases,
    timelineRecorder: caseTimelineRecorder,
    outbox: outboxEvents,
    unitOfWork: caseManagementUnitOfWork,
    clock,
    generateCaseId,
    generateTimelineEventId,
    generateOutboxEventId,
    auditRecorder: caseManagementAuditRecorder,
    assigneeDirectory,
    fraudConfig: organizationFraudConfig,
    initializeCaseSla,
    routeCase,
  });

  // El otro extremo del outbox: los eventos entran en la misma transaccion que
  // el caso —la parte dificil, la que garantiza que no se pierdan— pero sin un
  // relay se quedaban en PENDING indefinidamente.
  const publishOutboxEvents = createPublishOutboxEventsUseCase({
    outbox: outboxEvents,
    publisher: createLogOutboxPublisher(),
    clock,
  });

  const outboxPublishScheduler = createOutboxPublishScheduler({ publishOutboxEvents });

  const caseManagementFinturuRouter = finturuRouter({
    syncFinturuData,
    getFinturuDirectory,
    directorySyncScheduler,
    openFraudCase,
    finturuClient: finturuApiClient,
  });

  const finturuWebhook = finturuWebhookRouter({
    ingestFinturuCase,
    defaultOrganizationId: process.env.DEFAULT_ORGANIZATION_ID ?? '019d7e58aed0777318d11d4d',
    encryptionKey: process.env.FRAUD_DEPARTMENT_KEY,
  });

  const caseExportHttpRouter = caseExportRouter({
    exportCases: createExportCasesUseCase({ cases }),
  });
  const caseMetricsHttpRouter = metricsRouter({
    getFraudMetrics: createGetFraudMetricsUseCase({
      metrics: new MongoFraudMetricsReader(db),
      clock,
      assignees: assigneeDirectory,
    }),
  });
  const getOrganizationFraudConfig = createGetOrganizationFraudConfigUseCase({
    repository: organizationFraudConfig,
  });
  /*
   * Compartido: lo usa el router de informes (generacion manual) y el
   * orquestador que lo dispara solo al resolver. Una sola instancia para que
   * no puedan divergir.
   */
  const generateCaseReport = createGenerateCaseReportUseCase({
    cases,
    timelineReader: caseTimelineReader,
    notes: caseNotes,
    investigations,
    resolutions,
    enforcementActions,
    analystDecisions,
    evidence,
    approvalRequests,
    slaTracking: caseSlaTracking,
    assignees: assigneeDirectory,
    reports: caseReports,
    auditRecorder: caseManagementAuditRecorder,
    unitOfWork: caseManagementUnitOfWork,
    clock,
    generateCaseReportId,
  });

  /**
   * Compartido: lo sirve `/investigations/:id/summary` en vivo y lo consume
   * `ExportInvestigation` para congelarlo. Una sola instancia para que la
   * vista y el documento entregado no puedan divergir.
   */
  const exportInvestigationSummary = createExportInvestigationSummaryUseCase({
    cases,
    investigations,
    decisions: analystDecisions,
    enforcementActions,
    notes: caseNotes,
    evidence,
    buildEntityNetworkGraph: createBuildEntityNetworkGraphUseCase({ cases, investigations }),
    clock,
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
      notificationSender: caseManagementNotificationSender,
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
    updateCasePriorityTags: createUpdateCasePriorityTagsUseCase({
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
    bulkCaseAction: createBulkCaseActionUseCase({
      cases,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      assigneeDirectory,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateTimelineEventId,
    }),
    getCase: createGetCaseUseCase({ cases }),
    getCaseTimeline: createGetCaseTimelineUseCase({ cases, timelineReader: caseTimelineReader }),
    addCaseNote: createAddCaseNoteUseCase({
      cases,
      notes: caseNotes,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateCaseNoteId,
      generateTimelineEventId,
    }),
    listCaseNotes: createListCaseNotesUseCase({ cases, notes: caseNotes }),
    // Al resolver, el informe se congela solo. Ver `resolveToReportOrchestrator`.
    resolveCase: createResolveToReportOrchestrator({
      resolveCase: createResolveCaseUseCase({
        cases,
        resolutions,
        timelineRecorder: caseTimelineRecorder,
        auditRecorder: caseManagementAuditRecorder,
        unitOfWork: caseManagementUnitOfWork,
        clock,
        generateResolutionId,
        generateTimelineEventId,
        outbox: outboxEvents,
        generateOutboxEventId,
      }),
      generateCaseReport,
    }),
    archiveCase: createArchiveCaseUseCase({
      cases,
      resolutions,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateResolutionId,
      generateTimelineEventId,
    }),
    startReview: createStartReviewUseCase({
      cases,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateTimelineEventId,
    }),
  });
  const investigationHttpRouter = investigationRouter({
    openInvestigation: createOpenInvestigationUseCase({
      cases,
      investigations,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateInvestigationId,
    }),
    listInvestigations: createListInvestigationsUseCase({ cases, investigations }),
    getInvestigation: createGetInvestigationUseCase({ investigations }),
    buildEntityNetworkGraph: createBuildEntityNetworkGraphUseCase({ cases, investigations }),
    exportInvestigationSummary,
    exportInvestigation: createExportInvestigationUseCase({
      exportInvestigationSummary,
      reports: caseReports,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateCaseReportId,
    }),
    closeInvestigation: createCloseInvestigationUseCase({
      investigations,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
    }),
    updateInvestigationFindings: createUpdateInvestigationFindingsUseCase({
      investigations,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
    }),
    linkInvestigationCases: createLinkInvestigationCasesUseCase({
      investigations,
      cases,
      timelineRecorder: caseTimelineRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateTimelineEventId,
    }),
    listActiveInvestigations: createListActiveInvestigationsUseCase({ investigations }),
    updateInvestigationStatus: createUpdateInvestigationStatusUseCase({
      investigations,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
    }),
  });
  const organizationFraudConfigHttpRouter = organizationFraudConfigRouter({
    getOrganizationFraudConfig,
    upsertOrganizationFraudConfig: createUpsertOrganizationFraudConfigUseCase({
      repository: organizationFraudConfig,
      clock,
    }),
  });
  const evidenceStore: EvidenceStore =
    EVIDENCE_S3_BUCKET === undefined
      ? new FilesystemEvidenceStore(EVIDENCE_STORAGE_DIR)
      : new S3EvidenceStore({
          bucket: EVIDENCE_S3_BUCKET,
          region: EVIDENCE_S3_REGION,
          ...(EVIDENCE_S3_PREFIX === undefined ? {} : { prefix: EVIDENCE_S3_PREFIX }),
          ...(EVIDENCE_S3_ENDPOINT === undefined
            ? {}
            : { endpoint: EVIDENCE_S3_ENDPOINT, forcePathStyle: true }),
        });
  console.log(
    EVIDENCE_S3_BUCKET === undefined
      ? `Evidence store: filesystem (${EVIDENCE_STORAGE_DIR}) — presigned URLs unavailable`
      : `Evidence store: S3 bucket ${EVIDENCE_S3_BUCKET} (${EVIDENCE_S3_REGION})`,
  );

  const timestampAuthority: TimestampAuthority =
    TSA_URL === undefined
      ? new NullTimestampAuthority()
      : new Rfc3161TimestampAuthority({ url: TSA_URL, authorityName: TSA_AUTHORITY_NAME });
  console.log(
    TSA_URL === undefined
      ? 'RFC3161 timestamping: DISABLED — evidence is hashed but not sealed'
      : `RFC3161 timestamping: ${TSA_AUTHORITY_NAME}`,
  );

  const malwareScanner: MalwareScanner =
    CLAMAV_HOST === undefined
      ? new DisabledMalwareScanner()
      : new ClamAvMalwareScanner({ host: CLAMAV_HOST, port: CLAMAV_PORT });
  console.log(
    CLAMAV_HOST === undefined
      ? 'Malware scanning: DISABLED — uploads are recorded as SKIPPED, not CLEAN'
      : `Malware scanning: clamd at ${CLAMAV_HOST}:${CLAMAV_PORT}`,
  );

  const reportHttpRouter = reportRouter({
    generateCaseReport,
    listCaseReports: createListCaseReportsUseCase({ cases, reports: caseReports }),
    getCaseReport: createGetCaseReportUseCase({ reports: caseReports }),
    generateCaseAuditDossier: createGenerateCaseAuditDossierUseCase({
      cases,
      reports: caseReports,
      evidence,
      evidenceStore,
      timelineRecorder: caseTimelineRecorder,
      renderReportPdf: (report) => new CaseReportPdfRenderer().render(report),
      clock,
    }),
  });
  const evidenceHttpRouter = evidenceRouter({
    createEvidenceDownloadUrl: createCreateEvidenceDownloadUrlUseCase({
      evidence,
      evidenceStore,
      clock,
    }),
    registerEvidence: createRegisterEvidenceUseCase({
      cases,
      investigations,
      evidence,
      evidenceStore,
      timestampAuthority,
      malwareScanner,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateEvidenceId,
      generateTimelineEventId,
    }),
    listEvidence: createListEvidenceUseCase({ cases, evidence }),
    getEvidence: createGetEvidenceUseCase({ evidence }),
    downloadEvidence: createDownloadEvidenceUseCase({ evidence, evidenceStore }),
    deleteEvidence: createDeleteEvidenceUseCase({
      evidence,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateTimelineEventId,
    }),
  });
  const noteHttpRouter = noteRouter({
    deleteCaseNote: createDeleteCaseNoteUseCase({
      notes: caseNotes,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateTimelineEventId,
    }),
  });
  const customerOutgoingEvents = new MongoCustomerOutgoingEventRepository(db);
  const outgoingWebhookClient = new HttpOutgoingWebhookClient();
  const customerOutgoingEventDispatcher = createCustomerOutgoingEventDispatcher({
    outgoingEvents: customerOutgoingEvents,
    webhookClient: outgoingWebhookClient,
    fraudConfig: organizationFraudConfig,
    clock,
  });
  // casemgmt-notifications-sla-sweep PR2 (Slice 13): advances due
  // `CaseSlaTracking` rows and sends SLA_POR_VENCER via the same
  // `caseManagementNotificationSender` adapter used by `ReassignCase`.
  const sweepSlaTracking = createSweepSlaTrackingUseCase({
    slaTracking: caseSlaTracking,
    cases,
    notificationSender: caseManagementNotificationSender,
    assigneeDirectory,
    unitOfWork: caseManagementUnitOfWork,
    clock,
  });
  const slaSweepScheduler = createSlaSweepScheduler({ sweepSlaTracking });
  const enforcementHttpRouter = enforcementRouter({
    recordAnalystDecision: createRecordAnalystDecisionUseCase({
      cases,
      decisions: analystDecisions,
      enforcementActions,
      approvalRequests,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      notificationSender: caseManagementNotificationSender,
      assigneeDirectory,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateAnalystDecisionId,
      generateEnforcementActionId,
      generateApprovalRequestId,
      generateTimelineEventId,
    }),
    requestEnforcementAction: createRequestEnforcementActionUseCase({
      cases,
      decisions: analystDecisions,
      enforcementActions,
      approvalRequests,
      timelineRecorder: caseTimelineRecorder,
      auditRecorder: caseManagementAuditRecorder,
      notificationSender: caseManagementNotificationSender,
      assigneeDirectory,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateEnforcementActionId,
      generateApprovalRequestId,
      generateTimelineEventId,
    }),
    listCaseDecisions: createListCaseDecisionsUseCase({ cases, analystDecisions }),
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
      outbox: outboxEvents,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateCustomerOutgoingEventId,
      generateOutboxEventId,
    }),
    revertEnforcementAction: createRevertEnforcementActionUseCase({
      enforcementActions,
      auditRecorder: caseManagementAuditRecorder,
      outbox: outboxEvents,
      unitOfWork: caseManagementUnitOfWork,
      clock,
      generateOutboxEventId,
    }),
    listEnforcementActions: createListEnforcementActionsUseCase({ enforcementActions }),
  });
  const approvalRequestHttpRouter = approvalRequestRouter({
    reviewApprovalRequest: createReviewApprovalRequestUseCase({
      approvalRequests,
      enforcementActions,
      auditRecorder: caseManagementAuditRecorder,
      unitOfWork: caseManagementUnitOfWork,
      clock,
    }),
    listApprovalRequests: createListApprovalRequestsUseCase({
      enforcementActions,
      approvalRequests,
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
    // Ensayo en seco del editor: mismo motor que enruta en producción.
    simulateRoutingRule: createSimulateRoutingRuleUseCase({
      simulationEngine: caseRoutingEngine,
      auditRecorder: caseManagementAuditRecorder,
    }),
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
    // Ensayo en seco del editor: mismo motor que puntúa en producción.
    simulateScoringRule: createSimulateScoringRuleUseCase({
      simulationEngine: scoringEngine,
      auditRecorder: riskAssessmentAuditRecorder,
    }),
  });
  // Composition-only score→threshold→CreateCase path (eslint boundaries).
  const processRiskScoreToCase = createScoreToCaseOrchestrator({
    calculateRiskScore,
    getOrganizationFraudConfig,
    createCase,
  });

  // screening-watchlist-matcher Slice 7: watchlist screening ports/adapters,
  // wrapped around the SAME `processRiskScoreToCase` above so a revert is a
  // one-line swap back to it. `OpenAmlAlert` owns the transactional
  // aml_alerts + case_timeline + outbox_events write (natural-key unique
  // index still backs RF-6 idempotency against races).
  const amlAlerts = new MongoAmlAlertRepository(db);
  const amlExpedienteTimeline = new MongoAmlExpedienteTimelineRecorder(db);
  const screeningUnitOfWork = new ScreeningMongoUnitOfWork(client);
  const openAmlAlert = createOpenAmlAlertUseCase({
    amlAlertRepository: amlAlerts,
    timelineRecorder: amlExpedienteTimeline,
    outbox: outboxEvents,
    unitOfWork: screeningUnitOfWork,
    clock,
    generateAmlAlertId,
    generateTimelineEventId: generateObjectIdHex,
    generateOutboxEventId,
  });
  const getAmlAlert = createGetAmlAlertUseCase({ amlAlertRepository: amlAlerts });
  const listAmlAlerts = createListAmlAlertsUseCase({ amlAlertRepository: amlAlerts });
  const getAmlAlertTimeline = createGetAmlAlertTimelineUseCase({
    getAmlAlert,
    timelineRecorder: amlExpedienteTimeline,
  });
  const transitionAmlAlert = createTransitionAmlAlertUseCase({
    amlAlertRepository: amlAlerts,
    timelineRecorder: amlExpedienteTimeline,
    unitOfWork: screeningUnitOfWork,
    clock,
    generateTimelineEventId: generateObjectIdHex,
  });
  const escalateAmlAlert = createEscalateAmlAlertUseCase({
    amlAlertRepository: amlAlerts,
    caseOpener: createAmlAlertCaseOpener(createCase),
    timelineRecorder: amlExpedienteTimeline,
    unitOfWork: screeningUnitOfWork,
    clock,
    generateTimelineEventId: generateObjectIdHex,
  });
  // Screening's own AuditRecorder port, bridged at the composition root to
  // the SAME `recordAuditLog` instance built above (design D6/D7) — the
  // resolve disposition (RF-3) commits its audit row atomically with the
  // alert transition inside `screeningUnitOfWork.withTransaction`.
  const screeningAuditRecorder = createScreeningAuditRecorderAdapter(recordAuditLog);
  const resolveAmlAlert = createResolveAmlAlertUseCase({
    amlAlertRepository: amlAlerts,
    timelineRecorder: amlExpedienteTimeline,
    auditRecorder: screeningAuditRecorder,
    unitOfWork: screeningUnitOfWork,
    clock,
    generateTimelineEventId: generateObjectIdHex,
  });
  const amlAlertsHttpRouter = amlAlertRouter({
    listAmlAlerts,
    getAmlAlert,
    getAmlAlertTimeline,
    transitionAmlAlert,
    escalateAmlAlert,
    resolveAmlAlert,
  });
  const watchlistCandidates =
    SCREENING_MATCH_BACKEND === 'atlas'
      ? new MongoAtlasWatchlistCandidateRepository(db)
      : new MongoFallbackWatchlistCandidateRepository(db);
  const screenSubjectAgainstWatchlist = createScreenSubjectAgainstWatchlistUseCase({
    watchlistCandidateRepository: watchlistCandidates,
    openAmlAlert,
    phoneticEncoder: new TalismanPhoneticEncoder(),
    similarityCalculator: new TalismanSimilarityCalculator(),
  });
  const screenThenScoreToCase = createScreenThenScoreToCaseOrchestrator({
    screenSubject: screenSubjectAgainstWatchlist,
    scoreToCaseOrchestrator: processRiskScoreToCase,
  });
  // screening-producer-activation Slice 3 (design D-6/D-8): per-org confianza
  // thresholds. `screenSubjectAgainstWatchlist` above is built ONCE at
  // bootstrap without auth, so thresholds cannot be baked into its deps per
  // organization; instead they are resolved per REQUEST (request-scoped
  // override input — `ScreenSubjectAgainstWatchlistInput.thresholds`) and
  // passed through `screening` below. Missing config rows default to
  // `DEFAULT_CONFIDENCE_THRESHOLDS` (50/70) — RF-6, never a not-found error.
  const organizationScreeningConfig = new MongoOrganizationScreeningConfigRepository(db);
  const getOrganizationScreeningConfig = createGetOrganizationScreeningConfigUseCase({
    repository: organizationScreeningConfig,
  });
  // Same `ScoreToCaseOrchestratorInput` shape as `processRiskScoreToCase` —
  // both the webhook (`webhookToScoreOrchestrator`) and HTTP
  // (`scoreToCaseProcessRouter`) seams keep calling `{ auth, event }`
  // unchanged; this adapter derives the screening subject fields from the
  // event's `subjectIdentity` (optional `nombre`/`documento`/`walletAddress`/
  // `entryType`, defaulting to `PERSON`) so neither seam needs edits.
  const processRiskScoreToCaseWithScreening = async (
    scoreInput: ScoreToCaseOrchestratorInput,
  ): Promise<ScoreToCaseOrchestratorResult> => {
    const thresholds = await getOrganizationScreeningConfig({ auth: scoreInput.auth });
    return screenThenScoreToCase({
      auth: scoreInput.auth,
      event: scoreInput.event,
      screening: { ...deriveScreeningInput(scoreInput.event), thresholds },
    });
  };

  const riskScoreProcessRouter = scoreToCaseProcessRouter({
    processRiskScoreToCase: processRiskScoreToCaseWithScreening,
  });

  // provider-risk-ingest PR5b: webhook mount is not JWT. Same AesGcmSecretCipher
  // instance as identity-access (injected — ingest must not import that module).
  const inboundWebhookSecrets = new MongoInboundWebhookSecretRepository(db);
  const providerIngestEvents = new MongoProviderIngestEventRepository(db);
  const webhookToScore = createWebhookToScoreOrchestrator({
    processRiskScoreToCase: processRiskScoreToCaseWithScreening,
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
    // Sin `db` el paso 1 no puede resolver a que super admin pertenece el
    // reto: cae al correo por defecto, manda el OTP a una direccion que nadie
    // controla y nunca persiste el secreto TOTP.
    db,
    // Paso 2 del login de super admin: el OTP viaja por este remitente.
    emailSender,
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

  // Se comparte entre el paso 1 y el paso 3 del login de organizacion: el paso
  // 1 lo usa para rechazar credenciales invalidas ANTES de enviar el OTP, y el
  // paso 3 vuelve a verificarlas antes de emitir la sesion.
  const organizationAuthenticator = createAuthenticateActorUseCase({
    gateway: new OrganizationActorGateway(organizations),
    passwordHasher,
    clock,
    dummyCredential,
    actorType: 'ORGANIZATION',
    auditRecorder,
  });

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
    // Sin esto el paso 1 acepta cualquier email: responde OTP_REQUIRED y
    // dispara un correo a esa direccion, dejando la verificacion de
    // credenciales para el paso 3.
    authenticateOrganization: organizationAuthenticator,
    // Sin estas dos, el login de organizacion se degrada en silencio: el paso 1
    // no manda el OTP y los pasos 2-3 no leen ni guardan el secreto TOTP.
    emailSender,
    db,
    issueOrganizationSession: createIssueOrganizationSessionUseCase({
      authenticateActor: organizationAuthenticator,
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
      userRepositoryFactory,
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
  identityAccessRouter.use(caseExportHttpRouter);
  identityAccessRouter.use(caseMetricsHttpRouter);
  identityAccessRouter.use(caseManagementCasesRouter);
  identityAccessRouter.use(caseManagementFinturuRouter);
  identityAccessRouter.use(finturuWebhook);
  identityAccessRouter.use(investigationHttpRouter);
  identityAccessRouter.use(reportHttpRouter);
  identityAccessRouter.use(evidenceHttpRouter);
  identityAccessRouter.use(noteHttpRouter);
  identityAccessRouter.use(organizationFraudConfigHttpRouter);
  identityAccessRouter.use(enforcementHttpRouter);
  identityAccessRouter.use(approvalRequestHttpRouter);
  identityAccessRouter.use(routingRuleHttpRouter);
  identityAccessRouter.use(riskScoresRouter);
  identityAccessRouter.use(riskScoreProcessRouter);
  identityAccessRouter.use(riskScoringRulesRouter);
  identityAccessRouter.use(amlAlertsHttpRouter);
  identityAccessRouter.use(inboundWebhookSecretHttpRouter);

  const app = createApp({
    routers: [
      { path: '/api/v1', router: identityAccessRouter },
      // Finturu llama sin sesion, asi que el webhook se expone tambien fuera
      // de `/api/v1`. Va en `routers` y no en `webhookRouters` porque su
      // payload se descifra ya deserializado, no sobre los bytes crudos.
      { path: '/', router: finturuWebhook },
    ],
    webhookRouters: [{ path: '/webhooks', router: ingestWebhookRouter }],
    // Merged status maps: identity-access + notifications + case-management
    // + risk-assessment + screening + ingest closed error codes. Overlapping
    // keys (INVARIANT_VIOLATION=400, FORBIDDEN_CROSS_TENANT=403) agree, so
    // the spread is order-independent.
    errorHandler: createErrorHandler({
      ...identityAccessErrorStatus,
      ...notificationsErrorStatus,
      ...caseManagementErrorStatus,
      ...riskAssessmentErrorStatus,
      ...screeningErrorStatus,
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

  slaSweepScheduler.start(SLA_SWEEP_INTERVAL_MS);
  console.log(`SLA sweep scheduler started (interval=${SLA_SWEEP_INTERVAL_MS}ms)`);

  directorySyncScheduler.start();
  console.log('Finturu directory sync scheduler started');

  outboxPublishScheduler.start(OUTBOX_PUBLISH_INTERVAL_MS);
  console.log(`Outbox publish scheduler started (interval=${OUTBOX_PUBLISH_INTERVAL_MS}ms)`);

  app.listen(PORT, () => {
    console.log(`anti-fraud-department listening on port ${PORT}`);
  });
}

/**
 * screening-producer-activation Slice 2c (RF-4/D-5): derives the screening
 * subject (nombre/documento/walletAddress + entryType) from an incoming
 * `CanonicalRiskEvent.subjectIdentity`, now that both the webhook mappers
 * (Slice 2b) and the `/risk-scores/process` DTO (Slice 2c) populate it.
 * Only string values are honored; anything absent/malformed is simply
 * omitted, so a payload with no identity fields screens zero fields and
 * `screenSubject` returns `{ matches: [], riskSignal: null }` — a pure
 * passthrough to `processRiskScoreToCase`, matching RF-4 (never blocks).
 */
function deriveScreeningInput(
  event: CanonicalRiskEvent,
): Omit<ScreenSubjectAgainstWatchlistInput, 'auth'> {
  const subjectIdentity = event.subjectIdentity;
  const entryTypeRaw = subjectIdentity?.entryType;
  // Untrusted free-form value: fall back to PERSON on anything invalid rather
  // than throwing, which would abort the entire score-to-case path (and mark
  // webhooks failed) even when screening would otherwise be a no-op.
  const entryType = createEntryType(isEntryType(entryTypeRaw) ? entryTypeRaw : 'PERSON');
  const nombre = optionalString(subjectIdentity?.nombre);
  const documento = optionalString(subjectIdentity?.documento);
  const walletAddress = optionalString(subjectIdentity?.walletAddress);
  return {
    customerId: event.caseCustomerId,
    entryType,
    ...(nombre !== undefined ? { nombre } : {}),
    ...(documento !== undefined ? { documento } : {}),
    ...(walletAddress !== undefined ? { walletAddress } : {}),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exitCode = 1;
});
