import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { SarReport } from '../domain/model/aggregates/SarReport.js';
import type { SarReportRepository } from '../domain/ports/SarReportRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createSarReportId } from '../domain/model/value-objects/SarReportId.js';
import { forbiddenCrossTenant, sarReportNotFound } from '../domain/errors/SarError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SAR_WRITE_ROLES } from './authorization/policy.js';

/**
 * What came back from the regulator. A discriminated union rather than a bag
 * of optional fields: a rejection has no tracking number and an acceptance
 * has no reason, and letting both be optional on one shape is how a report
 * ends up marked FILED with nothing to show for it.
 */
export type SarFilingOutcome =
  | {
      readonly outcome: 'FILED';
      readonly bsaIdentifier: string;
      readonly filedAt: Instant;
      readonly acknowledgementReference?: string | null;
    }
  | { readonly outcome: 'REJECTED'; readonly reason: string };

export interface RecordSarFilingStatusInput {
  readonly auth: AuthContext;
  readonly sarReportId: string;
  readonly filing: SarFilingOutcome;
}

export interface RecordSarFilingStatusDeps {
  readonly reports: SarReportRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * SAR-004: `PATCH /sar-reports/:id/filing-status` — records the official
 * outcome of a submission.
 *
 * This use case does not FILE anything. Submission happens through FinCEN's
 * E-Filing system, outside this application; what lands here is the receipt.
 * That is why the date comes from the caller and why the aggregate does not
 * re-run the readiness checks — the report is already with the regulator, and
 * refusing to record that would leave the system claiming it never happened.
 *
 * SUPERVISOR only, same door as approving. No second pair of eyes: recording
 * an external fact is not an act of authority, and the report already passed
 * four eyes to be approved at all.
 */
export function createRecordSarFilingStatusUseCase(deps: RecordSarFilingStatusDeps) {
  return async function recordSarFilingStatus(
    input: RecordSarFilingStatusInput,
  ): Promise<SarReport> {
    requireOperationalRole(input.auth, SAR_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const sarReportId = createSarReportId(input.sarReportId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.reports.findById(sarReportId, tx);
      if (existing === null) {
        throw sarReportNotFound(sarReportId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('SAR report does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const previousStatus = existing.status;
      const updated =
        input.filing.outcome === 'FILED'
          ? existing.recordFiling({
              bsaIdentifier: input.filing.bsaIdentifier,
              filedAt: input.filing.filedAt,
              filedBy: input.auth.userId,
              acknowledgementReference: input.filing.acknowledgementReference ?? null,
              now,
            })
          : existing.recordFilingRejection({
              reason: input.filing.reason,
              recordedBy: input.auth.userId,
              now,
            });

      await deps.reports.save(updated, tx);

      /*
       * The tracking number IS in the audit detail, unlike the filer TIN in
       * `UpsertSarFilingProfile`. It is not a secret — it is the handle a
       * regulator uses to ask about this filing, and the audit row is exactly
       * where someone will look for it a year from now.
       */
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'RECORD_SAR_FILING_STATUS',
          resource: 'sar_report',
          resourceId: updated.id,
          detail: {
            previousStatus,
            status: updated.status,
            bsaIdentifier: updated.bsaIdentifier,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
