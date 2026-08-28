import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { SarReport } from '../domain/model/aggregates/SarReport.js';
import { SarReport as SarReportAggregate } from '../domain/model/aggregates/SarReport.js';
import type { SarReportId } from '../domain/model/value-objects/SarReportId.js';
import type { SarReportRepository } from '../domain/ports/SarReportRepository.js';
import type { SarSourceVerifier } from '../domain/ports/SarSourceVerifier.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { invariantViolation, sarSourceNotFound, sarSourceNotEligible } from '../domain/errors/SarError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SAR_WRITE_ROLES } from './authorization/policy.js';

export interface CreateSarReportDraftInput {
  readonly auth: AuthContext;
  readonly caseId?: string | null;
  readonly amlAlertId?: string | null;
  readonly narrative: string;
  readonly subjectName?: string | null;
  readonly suspiciousAmount?: number | null;
  readonly activityStartDate?: Instant | null;
  readonly activityEndDate?: Instant | null;
}

export interface CreateSarReportDraftDeps {
  readonly reports: SarReportRepository;
  readonly sourceVerifier: SarSourceVerifier;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateSarReportId: () => SarReportId;
}

/**
 * SAR-001: drafts a Suspicious Activity Report against exactly one
 * confirmed source (a case with a `FRAUD_CONFIRMED` decision, or an AML
 * alert resolved as a confirmed match). SUPERVISOR only.
 *
 * The eligibility check happens BEFORE the transaction (it is a read
 * against other modules' repositories, not a write of its own) — a source
 * that does not exist or is not confirmed never reaches persistence.
 */
export function createCreateSarReportDraftUseCase(deps: CreateSarReportDraftDeps) {
  return async function createSarReportDraft(input: CreateSarReportDraftInput): Promise<SarReport> {
    requireOperationalRole(input.auth, SAR_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const caseId = input.caseId ?? null;
    const amlAlertId = input.amlAlertId ?? null;
    if ((caseId === null) === (amlAlertId === null)) {
      throw invariantViolation(
        'exactly one of caseId or amlAlertId is required, never both or neither',
        { caseId, amlAlertId },
      );
    }

    if (caseId !== null) {
      const check = await deps.sourceVerifier.verifyCase(organizationId, caseId);
      if (!check.exists) throw sarSourceNotFound('case', caseId);
      if (!check.eligible) throw sarSourceNotEligible('case', caseId);
    } else {
      const check = await deps.sourceVerifier.verifyAmlAlert(organizationId, amlAlertId!);
      if (!check.exists) throw sarSourceNotFound('amlAlert', amlAlertId!);
      if (!check.eligible) throw sarSourceNotEligible('amlAlert', amlAlertId!);
    }

    const now = deps.clock.now();
    const report = SarReportAggregate.create({
      id: deps.generateSarReportId(),
      organizationId,
      caseId,
      amlAlertId,
      narrative: input.narrative,
      subjectName: input.subjectName ?? null,
      suspiciousAmount: input.suspiciousAmount ?? null,
      activityStartDate: input.activityStartDate ?? null,
      activityEndDate: input.activityEndDate ?? null,
      createdBy: input.auth.userId ?? 'SUPERVISOR',
      now,
    });

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.reports.save(report, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'CREATE_SAR_REPORT_DRAFT',
          resource: 'sar_report',
          resourceId: report.id,
          detail: {
            caseId: report.caseId,
            amlAlertId: report.amlAlertId,
            status: report.status,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return report;
    });
  };
}
