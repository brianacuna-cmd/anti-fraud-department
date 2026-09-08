import { toDate } from '../../../../shared/time/Instant.js';
import { sarNotApproved, sarXmlValidationFailed } from '../errors/SarError.js';
import type { SarReport } from '../model/aggregates/SarReport.js';

/**
 * SAR-003 gate, called before compiling the filing XML. Mirrors
 * `assertReadyForReport` (case-management/domain/services/WorkflowStepGate.ts):
 * a pure function, not a method on the aggregate, because "ready to file" is
 * a rule about the FILING FORMAT's requirements, not about the report's own
 * lifecycle invariants.
 *
 * Two failure modes, kept distinct: `SAR_NOT_APPROVED` (409 — the report
 * itself is fine, it just is not locked yet) vs `SAR_XML_VALIDATION_FAILED`
 * (422 — locked, but missing the fields a filing must carry). All
 * completeness errors are collected at once so a caller sees every gap in
 * one round trip instead of fixing them one at a time.
 */
export function assertReadyForFiling(report: SarReport): void {
  if (report.status !== 'APPROVED') {
    throw sarNotApproved(report.id, report.status);
  }

  const errors: string[] = [];

  if (report.subjectName === null || report.subjectName.trim().length === 0) {
    errors.push('subjectName is required to file a SAR');
  }
  if (report.suspiciousAmount === null || report.suspiciousAmount <= 0) {
    errors.push('suspiciousAmount is required and must be greater than zero');
  }
  if (report.activityStartDate === null) {
    errors.push('activityStartDate is required to file a SAR');
  } else if (
    report.activityEndDate !== null &&
    toDate(report.activityEndDate).getTime() < toDate(report.activityStartDate).getTime()
  ) {
    errors.push('activityEndDate cannot be earlier than activityStartDate');
  }
  if (report.narrative.trim().length < 20) {
    errors.push('narrative must describe the suspicious activity in at least 20 characters');
  }

  if (errors.length > 0) {
    throw sarXmlValidationFailed(report.id, errors);
  }
}
