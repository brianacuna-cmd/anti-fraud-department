import { oid } from '../../../../support/oid.js';
import { CaseReport } from '../../../../../src/modules/case-management/domain/model/aggregates/CaseReport.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createCaseReportId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('CaseReport', () => {
  it('creates a report carrying its frozen snapshot', () => {
    const report = CaseReport.create({
      id: createCaseReportId(oid('report-1')),
      caseId: createCaseId(oid('case-1')),
      organizationId: oid('org-1'),
      generatedBy: oid('analyst-1'),
      snapshot: { case: { id: oid('case-1') }, notes: [] },
      now: NOW,
    });
    expect(report.snapshot).toEqual({ case: { id: oid('case-1') }, notes: [] });
    expect(report.generatedBy).toBe(oid('analyst-1'));
    expect(report.createdAt).toBe(NOW);
  });

  it('rejects a blank generatedBy', () => {
    expect(() =>
      CaseReport.create({
        id: createCaseReportId(oid('report-1')),
        caseId: createCaseId(oid('case-1')),
        organizationId: oid('org-1'),
        generatedBy: '   ',
        snapshot: {},
        now: NOW,
      }),
    ).toThrow(CaseManagementError);
  });
});
