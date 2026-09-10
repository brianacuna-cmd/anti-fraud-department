import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { RegulatoryReport } from '../../../../src/modules/regulatory/domain/model/aggregates/RegulatoryReport.js';
import { createRegulatoryReportId, generateRegulatoryReportId } from '../../../../src/modules/regulatory/domain/model/value-objects/RegulatoryReportId.js';
import { EMPTY_FIGURES } from '../../../../src/modules/regulatory/domain/model/value-objects/RegulatoryFigures.js';
import { createCompileRegulatoryReportUseCase } from '../../../../src/modules/regulatory/application/CompileRegulatoryReport.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/regulatory/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryRegulatoryReportRepository } from '../../../helpers/regulatory/InMemoryRegulatoryReportRepository.js';
import { InMemoryRegulatoryAuditRecorder } from '../../../helpers/regulatory/InMemoryRegulatoryAuditRecorder.js';
import { FakeRegulatoryFigureSource } from '../../../helpers/regulatory/FakeRegulatoryFigureSource.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-10-05T00:00:00.000Z'));
const SEP_START = fromDate(new Date('2026-09-01T00:00:00.000Z'));
const SEP_END = fromDate(new Date('2026-09-30T23:59:59.000Z'));
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
  const reports = new InMemoryRegulatoryReportRepository();
  const figures = new FakeRegulatoryFigureSource();
  const auditRecorder = new InMemoryRegulatoryAuditRecorder();

  const compileRegulatoryReport = createCompileRegulatoryReportUseCase({
    reports,
    figures,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateRegulatoryReportId,
  });

  return { compileRegulatoryReport, reports, figures, auditRecorder };
}

describe('createCompileRegulatoryReportUseCase', () => {
  it('congela las cifras del periodo y las audita', async () => {
    const { compileRegulatoryReport, reports, auditRecorder, figures } = build();
    figures.returns({ casesOpened: 120, fraudConfirmed: 14, sarsFiled: 3, suspiciousAmountDeclared: 45000 });

    const report = await compileRegulatoryReport({
      auth: SUPERVISOR,
      periodStart: SEP_START,
      periodEnd: SEP_END,
    });

    expect(report.status).toBe('DRAFT');
    expect(report.figures.casesOpened).toBe(120);
    expect(report.figures.suspiciousAmountDeclared).toBe(45000);
    expect(reports.all()).toHaveLength(1);

    const [event] = auditRecorder.all();
    expect(event!.action).toBe('COMPILE_REGULATORY_REPORT');
    // Las cifras van también a la traza: si alguien recompila, la auditoría
    // conserva lo que decía la versión anterior.
    expect((event!.detail.figures as { casesOpened: number }).casesOpened).toBe(120);
    expect(event!.detail.recompiled).toBe(false);
  });

  it('los montos bloqueados salen null, nunca cero', async () => {
    const { compileRegulatoryReport, figures } = build();
    figures.returns({ enforcementExecuted: 9 });

    const report = await compileRegulatoryReport({
      auth: SUPERVISOR,
      periodStart: SEP_START,
      periodEnd: SEP_END,
    });

    // Un 0 afirmaría que no se bloqueó nada; null dice que el dato no existe.
    expect(report.figures.blockedAmount).toBeNull();
    expect(report.figures.enforcementExecuted).toBe(9);
  });

  it('recompilar un borrador lo actualiza en vez de crear otro reporte', async () => {
    const { compileRegulatoryReport, reports, figures } = build();
    figures.returns({ casesResolved: 40 });
    const first = await compileRegulatoryReport({
      auth: SUPERVISOR,
      periodStart: SEP_START,
      periodEnd: SEP_END,
    });

    figures.returns({ casesResolved: 47 });
    const second = await compileRegulatoryReport({
      auth: SUPERVISOR,
      periodStart: SEP_START,
      periodEnd: SEP_END,
      reportId: first.id,
    });

    expect(second.id).toBe(first.id);
    expect(second.figures.casesResolved).toBe(47);
    // Sin esto quedarían dos reportes de septiembre con cifras distintas y
    // ninguna forma de saber cuál se presentó.
    expect(reports.all()).toHaveLength(1);
  });

  it('un reporte ya emitido no se recompila', async () => {
    const { compileRegulatoryReport, reports } = build();
    const id = createRegulatoryReportId(oid('rep-1'));
    reports.seed(
      RegulatoryReport.create({
        id,
        organizationId: ORG_1,
        periodStart: SEP_START,
        periodEnd: SEP_END,
        figures: EMPTY_FIGURES,
        generatedBy: oid('sup-1'),
        now: NOW,
      }).issue(oid('sup-2'), NOW),
    );

    await expect(
      compileRegulatoryReport({
        auth: SUPERVISOR,
        periodStart: SEP_START,
        periodEnd: SEP_END,
        reportId: id,
      }),
    ).rejects.toMatchObject({ code: 'REPORT_ALREADY_ISSUED' });
  });

  it('rechaza un periodo que llega al futuro', async () => {
    const { compileRegulatoryReport } = build();

    await expect(
      compileRegulatoryReport({
        auth: SUPERVISOR,
        periodStart: SEP_START,
        // El "ahora" del reloj es el 5 de octubre: pedir hasta el 31 daría un
        // reporte parcial presentado como definitivo.
        periodEnd: fromDate(new Date('2026-10-31T00:00:00.000Z')),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REPORTING_PERIOD' });
  });

  it('rechaza un periodo invertido', async () => {
    const { compileRegulatoryReport } = build();

    await expect(
      compileRegulatoryReport({
        auth: SUPERVISOR,
        periodStart: SEP_END,
        periodEnd: SEP_START,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REPORTING_PERIOD' });
  });

  it('un ANALYST no compila reportes regulatorios', async () => {
    const { compileRegulatoryReport, reports } = build();

    await expect(
      compileRegulatoryReport({ auth: ANALYST, periodStart: SEP_START, periodEnd: SEP_END }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    expect(reports.all()).toHaveLength(0);
  });

  it('un borrador de otro inquilino no existe', async () => {
    const { compileRegulatoryReport, reports } = build();
    const id = createRegulatoryReportId(oid('rep-2'));
    reports.seed(
      RegulatoryReport.create({
        id,
        organizationId: ORG_2,
        periodStart: SEP_START,
        periodEnd: SEP_END,
        figures: EMPTY_FIGURES,
        generatedBy: oid('sup-9'),
        now: NOW,
      }),
    );

    await expect(
      compileRegulatoryReport({
        auth: SUPERVISOR,
        periodStart: SEP_START,
        periodEnd: SEP_END,
        reportId: id,
      }),
    ).rejects.toMatchObject({ code: 'REGULATORY_REPORT_NOT_FOUND' });
  });

  it('pide las cifras del periodo y del inquilino de la sesión', async () => {
    const { compileRegulatoryReport, figures } = build();

    await compileRegulatoryReport({ auth: SUPERVISOR, periodStart: SEP_START, periodEnd: SEP_END });

    expect(figures.asked()).toEqual([
      { organizationId: ORG_1, periodStart: SEP_START, periodEnd: SEP_END },
    ]);
  });
});
