import { ObjectId } from 'mongodb';
import { fromDate } from '../../../../../../../shared/time/Instant.js';
import { RegulatoryReport } from '../../../../../domain/model/aggregates/RegulatoryReport.js';
import { createRegulatoryReportId } from '../../../../../domain/model/value-objects/RegulatoryReportId.js';
import { createRegulatoryReportStatus } from '../../../../../domain/model/value-objects/RegulatoryReportStatus.js';
import type { RegulatoryReportDocument } from '../documents/RegulatoryReportDocument.js';

export function toDocument(report: RegulatoryReport): RegulatoryReportDocument {
  const p = report.toProps();
  const f = p.figures;
  return {
    _id: new ObjectId(p.id),
    organization_id: new ObjectId(p.organizationId),
    period_start: new Date(p.periodStart),
    period_end: new Date(p.periodEnd),
    status: p.status,
    figures: {
      cases_opened: f.casesOpened,
      cases_resolved: f.casesResolved,
      fraud_confirmed: f.fraudConfirmed,
      false_positives: f.falsePositives,
      sla_breached: f.slaBreached,
      enforcement_executed: f.enforcementExecuted,
      enforcement_reverted: f.enforcementReverted,
      sars_filed: f.sarsFiled,
      suspicious_amount_declared: f.suspiciousAmountDeclared,
      blocked_amount: null,
    },
    generated_by: p.generatedBy,
    generated_at: new Date(p.generatedAt),
    issued_by: p.issuedBy,
    issued_at: p.issuedAt === null ? null : new Date(p.issuedAt),
    created_at: new Date(p.createdAt),
    updated_at: new Date(p.updatedAt),
  };
}

export function toDomain(document: RegulatoryReportDocument): RegulatoryReport {
  const f = document.figures;
  return RegulatoryReport.rehydrate({
    id: createRegulatoryReportId(document._id.toHexString()),
    organizationId: document.organization_id.toHexString(),
    periodStart: fromDate(document.period_start),
    periodEnd: fromDate(document.period_end),
    status: createRegulatoryReportStatus(document.status),
    figures: {
      casesOpened: f.cases_opened,
      casesResolved: f.cases_resolved,
      fraudConfirmed: f.fraud_confirmed,
      falsePositives: f.false_positives,
      slaBreached: f.sla_breached,
      enforcementExecuted: f.enforcement_executed,
      enforcementReverted: f.enforcement_reverted,
      sarsFiled: f.sars_filed,
      suspiciousAmountDeclared: f.suspicious_amount_declared,
      blockedAmount: null,
    },
    generatedBy: document.generated_by,
    generatedAt: fromDate(document.generated_at),
    issuedBy: document.issued_by,
    issuedAt: document.issued_at === null ? null : fromDate(document.issued_at),
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
