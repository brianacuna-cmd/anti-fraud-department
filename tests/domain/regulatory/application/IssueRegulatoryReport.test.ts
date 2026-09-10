import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { RegulatoryReport } from '../../../../src/modules/regulatory/domain/model/aggregates/RegulatoryReport.js';
import { createRegulatoryReportId } from '../../../../src/modules/regulatory/domain/model/value-objects/RegulatoryReportId.js';
import { EMPTY_FIGURES } from '../../../../src/modules/regulatory/domain/model/value-objects/RegulatoryFigures.js';
import { createIssueRegulatoryReportUseCase } from '../../../../src/modules/regulatory/application/IssueRegulatoryReport.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/regulatory/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryRegulatoryReportRepository } from '../../../helpers/regulatory/InMemoryRegulatoryReportRepository.js';
import { InMemoryRegulatoryAuditRecorder } from '../../../helpers/regulatory/InMemoryRegulatoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-10-05T00:00:00.000Z'));
const SEP_START = fromDate(new Date('2026-09-01T00:00:00.000Z'));
const SEP_END = fromDate(new Date('2026-09-30T23:59:59.000Z'));
const ORG_1 = oid('org-1');
const ID = createRegulatoryReportId(oid('rep-1'));

const SUPERVISOR = createAuthContext({
  userId: oid('sup-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ANALYST = createAuthContext({
  userId: oid('an-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function draft(): RegulatoryReport {
  return RegulatoryReport.create({
    id: ID,
    organizationId: ORG_1,
    periodStart: SEP_START,
    periodEnd: SEP_END,
    figures: EMPTY_FIGURES,
    generatedBy: oid('sup-1'),
    now: NOW,
  });
}

function build(report?: RegulatoryReport) {
  const reports = new InMemoryRegulatoryReportRepository();
  if (report !== undefined) {
    reports.seed(report);
  }
  const auditRecorder = new InMemoryRegulatoryAuditRecorder();
  const issueRegulatoryReport = createIssueRegulatoryReportUseCase({
    reports,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });
  return { issueRegulatoryReport, reports, auditRecorder };
}

describe('createIssueRegulatoryReportUseCase', () => {
  it('freezes a draft as ISSUED and audits the figures', async () => {
    const { issueRegulatoryReport, reports, auditRecorder } = build(draft());

    const issued = await issueRegulatoryReport({ auth: SUPERVISOR, reportId: ID });

    expect(issued.status).toBe('ISSUED');
    expect(issued.issuedBy).toBe(SUPERVISOR.userId);
    expect(reports.all()[0]!.status).toBe('ISSUED');
    expect(auditRecorder.all()[0]!.action).toBe('ISSUE_REGULATORY_REPORT');
  });

  it('rejects a second issue of the same report', async () => {
    const { issueRegulatoryReport } = build(draft().issue(oid('sup-2'), NOW));

    await expect(issueRegulatoryReport({ auth: SUPERVISOR, reportId: ID })).rejects.toMatchObject({
      code: 'REPORT_ALREADY_ISSUED',
    });
  });

  it('rejects ANALYST', async () => {
    const { issueRegulatoryReport } = build(draft());

    await expect(issueRegulatoryReport({ auth: ANALYST, reportId: ID })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
  });
});
