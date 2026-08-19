import { toCaseExportRow, type CaseExportRow } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/export/CaseExportRow.js';
import { JsonCaseExportRenderer } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/export/JsonCaseExportRenderer.js';
import { XlsxCaseExportRenderer } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/export/XlsxCaseExportRenderer.js';
import { PdfCaseExportRenderer } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/export/PdfCaseExportRenderer.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

const ROWS: CaseExportRow[] = [
  {
    id: oid('case-1'),
    status: 'OPEN',
    priority: 'HIGH',
    riskScore: 80,
    customerId: 'customer-1',
    customerEmail: 'a@b.com',
    assignedToType: 'USER',
    assignedToId: oid('an-1'),
    tags: 'fraud, aml',
    dueDate: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

describe('Case export renderers', () => {
  it('JSON renderer emits parseable { items, total }', async () => {
    const buffer = await new JsonCaseExportRenderer().render(ROWS);
    const parsed = JSON.parse(buffer.toString('utf-8'));
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].id).toBe(ROWS[0]!.id);
  });

  it('XLSX renderer emits a non-empty zip (PK magic bytes)', async () => {
    const buffer = await new XlsxCaseExportRenderer().render(ROWS);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('PDF renderer emits a document with the %PDF header', async () => {
    const buffer = await new PdfCaseExportRenderer().render(ROWS);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('toCaseExportRow flattens a Case (tags joined, nullables blanked)', () => {
    const kase = Case.create({
      id: createCaseId(oid('case-2')),
      organizationId: oid('org-1'),
      customerId: 'customer-2',
      riskScore: createRiskScore(50),
      priority: 'MEDIUM',
      tags: ['a', 'b'],
      now: NOW,
    }).reassign(createAssignedTo('USER', oid('an-9')), NOW);

    const row = toCaseExportRow(kase);
    expect(row.tags).toBe('a, b');
    expect(row.assignedToId).toBe(oid('an-9'));
    expect(row.customerEmail).toBe('');
    expect(row.dueDate).toBe('');
  });
});
