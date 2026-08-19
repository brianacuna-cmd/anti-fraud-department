import { createExportCasesUseCase } from '../../../../src/modules/case-management/application/ExportCases.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-07-15T09:30:00.000Z'));
const ORG_1 = createAuthContext({ userId: 'analyst-1', organizationId: 'org-1', actorType: 'USER' });

function seedCase(
  cases: InMemoryCaseRepository,
  overrides: {
    organizationId?: string;
    customerId?: string;
    email?: string | null;
    priority?: string;
    tags?: string[];
  } = {},
) {
  const kase = Case.create({
    id: generateCaseId(),
    organizationId: overrides.organizationId ?? 'org-1',
    customerId: overrides.customerId ?? 'customer-1',
    customerEmail: overrides.email ?? null,
    riskScore: createRiskScore(70),
    priority: createCasePriority(overrides.priority ?? 'HIGH'),
    tags: overrides.tags ?? ['AML', 'CHARGEBACK'],
    now: NOW,
  });
  void cases.save(kase);
  return kase;
}

function build() {
  const cases = new InMemoryCaseRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const exportCases = createExportCasesUseCase({ cases, auditRecorder, clock: new FixedClock(NOW) });
  return { cases, auditRecorder, exportCases };
}

/** Filas de datos, sin cabecera y sin la linea final vacia. */
const dataRows = (csv: string) => csv.replace(/^﻿/, '').trim().split('\r\n').slice(1);

describe('createExportCasesUseCase', () => {
  it('emits a header row followed by one row per case', async () => {
    const { cases, exportCases } = build();
    seedCase(cases, { customerId: 'customer-1' });
    seedCase(cases, { customerId: 'customer-2' });

    const result = await exportCases({ auth: ORG_1 });

    const lines = result.csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,organizationId,customerId,customerEmail,bridgeUserId,bridgeWallet,stripeCustomerId,riskScore,status,priority,assignedToType,assignedToId,tags,dueDate,createdAt,updatedAt',
    );
    expect(result.rowCount).toBe(2);
    expect(lines).toHaveLength(3);
  });

  it('never exports another tenant rows', async () => {
    const { cases, exportCases } = build();
    seedCase(cases, { organizationId: 'org-1', customerId: 'mine' });
    seedCase(cases, { organizationId: 'org-2', customerId: 'theirs' });

    const result = await exportCases({ auth: ORG_1 });

    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain('mine');
    expect(result.csv).not.toContain('theirs');
  });

  it('applies the same filters the listing uses', async () => {
    const { cases, exportCases } = build();
    seedCase(cases, { customerId: 'high', priority: 'HIGH' });
    seedCase(cases, { customerId: 'low', priority: 'LOW' });

    const result = await exportCases({ auth: ORG_1, priority: 'LOW' });

    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain('low');
    expect(result.csv).not.toContain(',high,');
  });

  it('escapes commas and quotes per RFC 4180', async () => {
    const { cases, exportCases } = build();
    seedCase(cases, { customerId: 'Gonzalez, Augusto "Tuto"' });

    const rows = dataRows((await exportCases({ auth: ORG_1 })).csv);

    expect(rows[0]).toContain('"Gonzalez, Augusto ""Tuto"""');
  });

  it('neutralizes spreadsheet formula injection in attacker-controlled fields', async () => {
    const { cases, exportCases } = build();
    // El email de un cliente es dato de un tercero: sin neutralizar, Excel
    // ejecutaria esto al abrir el fichero de auditoria.
    seedCase(cases, { customerId: 'c-1', email: '=HYPERLINK("http://evil.test","cobrar")' });

    const rows = dataRows((await exportCases({ auth: ORG_1 })).csv);

    expect(rows[0]).toContain(`'=HYPERLINK`);
    expect(rows[0]).not.toMatch(/,=HYPERLINK/);
  });

  it.each(['+1', '-1', '@SUM(A1)'])('neutralizes a cell starting with %s', async (value) => {
    const { cases, exportCases } = build();
    seedCase(cases, { customerId: value });

    const rows = dataRows((await exportCases({ auth: ORG_1 })).csv);

    expect(rows[0]).toContain(`'${value}`);
  });

  it('joins tags with a pipe so the comma stays the column separator', async () => {
    const { cases, exportCases } = build();
    seedCase(cases, { tags: ['AML', 'SANCTIONS'] });

    const rows = dataRows((await exportCases({ auth: ORG_1 })).csv);

    expect(rows[0]).toContain('AML|SANCTIONS');
  });

  it('starts with a BOM so Excel on Windows reads it as UTF-8', async () => {
    const { cases, exportCases } = build();
    seedCase(cases, { customerId: 'Muñoz Peña' });

    const result = await exportCases({ auth: ORG_1 });

    expect(result.csv.startsWith('﻿')).toBe(true);
    expect(result.csv).toContain('Muñoz Peña');
  });

  it('names the file after the export date', async () => {
    const { exportCases } = build();

    const result = await exportCases({ auth: ORG_1 });

    expect(result.filename).toBe('casos-2026-07-15.csv');
  });

  it('records one EXPORT_CASES audit row naming how many rows left the system', async () => {
    const { cases, exportCases, auditRecorder } = build();
    seedCase(cases);
    seedCase(cases, { customerId: 'customer-2' });

    await exportCases({ auth: ORG_1 });

    expect(auditRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('EXPORT_CASES');
    expect(auditRecorder.all()[0]?.detail).toMatchObject({ rowCount: 2, truncated: false });
  });

  it('returns just the header when nothing matches', async () => {
    const { exportCases } = build();

    const result = await exportCases({ auth: ORG_1 });

    expect(result.rowCount).toBe(0);
    expect(dataRows(result.csv)).toEqual([]);
  });
});
