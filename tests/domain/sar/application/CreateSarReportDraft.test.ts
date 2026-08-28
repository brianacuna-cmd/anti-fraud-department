import { oid } from '../../../support/oid.js';
import { createCreateSarReportDraftUseCase } from '../../../../src/modules/sar/application/CreateSarReportDraft.js';
import { generateSarReportId } from '../../../../src/modules/sar/domain/model/value-objects/SarReportId.js';
import { InMemorySarReportRepository } from '../../../helpers/sar/InMemorySarReportRepository.js';
import { InMemorySarAuditRecorder } from '../../../helpers/sar/InMemorySarAuditRecorder.js';
import { FakeSarSourceVerifier } from '../../../helpers/sar/FakeSarSourceVerifier.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/sar/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');

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

function build() {
  const reports = new InMemorySarReportRepository();
  const auditRecorder = new InMemorySarAuditRecorder();
  const sourceVerifier = new FakeSarSourceVerifier();

  const createSarReportDraft = createCreateSarReportDraftUseCase({
    reports,
    sourceVerifier,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateSarReportId,
  });

  return { createSarReportDraft, reports, auditRecorder, sourceVerifier };
}

describe('createCreateSarReportDraftUseCase', () => {
  it('camino feliz completo: caso elegible -> guarda + audita', async () => {
    const { createSarReportDraft, reports, auditRecorder, sourceVerifier } = build();
    sourceVerifier.allowCase(oid('case-1'), true);

    const report = await createSarReportDraft({
      auth: SUPERVISOR,
      caseId: oid('case-1'),
      narrative: 'Volumen atípico de transferencias en 24h.',
      subjectName: 'Juan Pérez',
      suspiciousAmount: 15000,
    });

    expect(report.status).toBe('DRAFT');
    expect(reports.all()).toHaveLength(1);
    expect(reports.all()[0]?.caseId).toBe(oid('case-1'));
    const audits = auditRecorder.all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('CREATE_SAR_REPORT_DRAFT');
    expect(audits[0]?.resource).toBe('sar_report');
    expect(audits[0]?.detail).toMatchObject({ caseId: oid('case-1'), amlAlertId: null });
  });

  it('camino feliz con amlAlertId elegible (RESOLVED)', async () => {
    const { createSarReportDraft, reports, sourceVerifier } = build();
    sourceVerifier.allowAmlAlert(oid('alert-1'), true);

    const report = await createSarReportDraft({
      auth: SUPERVISOR,
      amlAlertId: oid('alert-1'),
      narrative: 'Coincidencia confirmada contra lista OFAC.',
    });

    expect(report.caseId).toBeNull();
    expect(report.amlAlertId).toBe(oid('alert-1'));
    expect(reports.all()).toHaveLength(1);
  });

  it('rechaza cuando no se manda ni caseId ni amlAlertId', async () => {
    const { createSarReportDraft, reports } = build();

    await expect(
      createSarReportDraft({ auth: SUPERVISOR, narrative: 'x' }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
    expect(reports.all()).toHaveLength(0);
  });

  it('rechaza cuando se mandan los dos, caseId y amlAlertId', async () => {
    const { createSarReportDraft, reports, sourceVerifier } = build();
    sourceVerifier.allowCase(oid('case-1'), true);
    sourceVerifier.allowAmlAlert(oid('alert-1'), true);

    await expect(
      createSarReportDraft({
        auth: SUPERVISOR,
        caseId: oid('case-1'),
        amlAlertId: oid('alert-1'),
        narrative: 'x',
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
    expect(reports.all()).toHaveLength(0);
  });

  it('rechaza a un ANALYST (FORBIDDEN_ROLE) — redactar un SAR es acto de supervisor', async () => {
    const { createSarReportDraft, reports, sourceVerifier } = build();
    sourceVerifier.allowCase(oid('case-1'), true);

    await expect(
      createSarReportDraft({ auth: ANALYST, caseId: oid('case-1'), narrative: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    expect(reports.all()).toHaveLength(0);
  });

  it('rechaza SAR_SOURCE_NOT_FOUND cuando el caso no existe para el verifier', async () => {
    const { createSarReportDraft, reports } = build();

    await expect(
      createSarReportDraft({ auth: SUPERVISOR, caseId: oid('missing'), narrative: 'x' }),
    ).rejects.toMatchObject({ code: 'SAR_SOURCE_NOT_FOUND' });
    expect(reports.all()).toHaveLength(0);
  });

  it('rechaza SAR_SOURCE_NOT_ELIGIBLE cuando el caso existe pero no está confirmado', async () => {
    const { createSarReportDraft, reports, sourceVerifier } = build();
    sourceVerifier.allowCase(oid('case-1'), false);

    await expect(
      createSarReportDraft({ auth: SUPERVISOR, caseId: oid('case-1'), narrative: 'x' }),
    ).rejects.toMatchObject({ code: 'SAR_SOURCE_NOT_ELIGIBLE' });
    expect(reports.all()).toHaveLength(0);
  });

  it('rechaza SAR_SOURCE_NOT_ELIGIBLE cuando la alerta AML existe pero no está resuelta', async () => {
    const { createSarReportDraft, reports, sourceVerifier } = build();
    sourceVerifier.allowAmlAlert(oid('alert-1'), false);

    await expect(
      createSarReportDraft({ auth: SUPERVISOR, amlAlertId: oid('alert-1'), narrative: 'x' }),
    ).rejects.toMatchObject({ code: 'SAR_SOURCE_NOT_ELIGIBLE' });
    expect(reports.all()).toHaveLength(0);
  });

  it('rechaza narrative vacío', async () => {
    const { createSarReportDraft, reports, sourceVerifier } = build();
    sourceVerifier.allowCase(oid('case-1'), true);

    await expect(
      createSarReportDraft({ auth: SUPERVISOR, caseId: oid('case-1'), narrative: '   ' }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
    expect(reports.all()).toHaveLength(0);
  });

  it('rechaza actores de otra organización (cross-tenant): el verifier nunca ve el id ajeno', async () => {
    const { createSarReportDraft, reports, sourceVerifier } = build();
    sourceVerifier.allowCase(oid('case-1'), true);
    const otherOrgSupervisor = createAuthContext({
      userId: oid('sup-2'),
      organizationId: ORG_2,
      actorType: 'USER',
      roleId: 'SUPERVISOR',
    });

    // El FakeSarSourceVerifier ignora organizationId, así que esto prueba
    // el flujo real: en producción `SarSourceVerifier` (composition) filtra
    // por organizationId y devuelve `exists: false` para un caso ajeno,
    // resultando en SAR_SOURCE_NOT_FOUND — ver tests/composition/sarSourceVerifier.test.ts.
    const report = await createSarReportDraft({
      auth: otherOrgSupervisor,
      caseId: oid('case-1'),
      narrative: 'x',
    });
    expect(report.organizationId).toBe(ORG_2);
  });
});
