import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { SarReport } from '../domain/model/aggregates/SarReport.js';
import type { OrganizationSarFilingProfile } from '../domain/model/aggregates/OrganizationSarFilingProfile.js';
import { createSarReportId } from '../domain/model/value-objects/SarReportId.js';
import { assessFilingReadiness } from '../domain/services/SarFilingReadiness.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { OrganizationSarFilingProfileRepository } from '../domain/ports/OrganizationSarFilingProfileRepository.js';
import type { SarReportRepository } from '../domain/ports/SarReportRepository.js';
import { forbiddenCrossTenant, sarNotReadyToFile, sarReportNotFound } from '../domain/errors/SarError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SAR_WRITE_ROLES } from './authorization/policy.js';

export interface GenerateSarReportXmlInput {
  readonly auth: AuthContext;
  readonly sarReportId: string;
}

export interface GenerateSarReportXmlResult {
  readonly report: SarReport;
  readonly profile: OrganizationSarFilingProfile;
}

export interface GenerateSarReportXmlDeps {
  readonly reports: SarReportRepository;
  readonly profiles: OrganizationSarFilingProfileRepository;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
}

/**
 * SAR-003 — gathers everything the filing document needs and refuses to
 * produce one that would bounce.
 *
 * The use case does NOT render: it loads, checks tenancy, runs
 * `assessFilingReadiness` and hands the caller a report and a profile that
 * are known good. Serialising them is the HTTP adapter's job, the same split
 * `GenerateCaseReport` uses with the PDF renderer — which is what lets the
 * same checked pair be rendered as something other than XML later without
 * touching a single rule.
 *
 * No transaction: this reads and audits, it changes nothing.
 */
export function createGenerateSarReportXmlUseCase(deps: GenerateSarReportXmlDeps) {
  return async function generateSarReportXml(
    input: GenerateSarReportXmlInput,
  ): Promise<GenerateSarReportXmlResult> {
    requireOperationalRole(input.auth, SAR_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const reportId = createSarReportId(input.sarReportId);

    const report = await deps.reports.findById(reportId);
    if (report === null) {
      throw sarReportNotFound(reportId);
    }
    if (report.organizationId !== organizationId) {
      throw forbiddenCrossTenant('the SAR report does not belong to the actor organization');
    }

    const profile = await deps.profiles.findByOrganization(organizationId);
    const defects = assessFilingReadiness(report, profile, deps.clock.now());

    if (defects.length > 0 || profile === null) {
      /*
       * Audited even on refusal. An attempt to file an incomplete report is
       * exactly the event a regulator asks about later — "we tried, it was
       * incomplete, here is when" is a defensible answer; silence is not.
       */
      await deps.auditRecorder.record({
        organizationId,
        actorType: input.auth.actorType,
        actorId: input.auth.userId,
        action: 'GENERATE_SAR_REPORT_FILE',
        resource: 'sar_report',
        resourceId: report.id,
        detail: { generated: false, defectCount: defects.length },
        ipAddress: input.auth.ipAddress,
      });
      throw sarNotReadyToFile(report.id, defects);
    }

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'GENERATE_SAR_REPORT_FILE',
      resource: 'sar_report',
      resourceId: report.id,
      detail: {
        generated: true,
        format: 'FINCEN_XML',
        categories: [...report.activityCategories],
      },
      ipAddress: input.auth.ipAddress,
    });

    return { report, profile };
  };
}
