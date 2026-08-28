import { oid } from '../../../support/oid.js';
import { createRecordSarFilingStatusUseCase } from '../../../../src/modules/sar/application/RecordSarFilingStatus.js';
import { SarReport } from '../../../../src/modules/sar/domain/model/aggregates/SarReport.js';
import { generateSarReportId } from '../../../../src/modules/sar/domain/model/value-objects/SarReportId.js';
import { InMemorySarReportRepository } from '../../../helpers/sar/InMemorySarReportRepository.js';
import { InMemorySarAuditRecorder } from '../../../helpers/sar/InMemorySarAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/sar/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-06-10T00:00:00.000Z'));
const FILED_AT = fromDate(new Date('2026-06-08T00:00:00.000Z'));
const ORG = oid('org-1');
const BSA_ID = '31000012345678';

const SUPERVISOR = createAuthContext({
  userId: oid('sup-2'),
  organizationId: ORG,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ANALYST = createAuthContext({
  userId: oid('an-1'),
  organizationId: ORG,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function build() {
  const reports = new InMemorySarReportRepository();
  const auditRecorder = new InMemorySarAuditRecorder();
  const recordSarFilingStatus = createRecordSarFilingStatusUseCase({
    reports,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });
  return { recordSarFilingStatus, reports, auditRecorder };
}

/** Seeds a report in the given state and returns its id. */
async function seed(
  reports: InMemorySarReportRepository,
  state: 'DRAFT' | 'APPROVED',
): Promise<string> {
  const draft = SarReport.create({
    id: generateSarReportId(),
    organizationId: ORG,
    caseId: oid('case-1'),
    narrative: 'Structured deposits below the reporting threshold.',
    createdBy: oid('an-1'),
    now: NOW,
  });
  const report = state === 'APPROVED' ? draft.approve(oid('sup-2'), NOW) : draft;
  await reports.save(report);
  return report.id;
}

describe('recordSarFilingStatus', () => {
  it('records the tracking number, the date and the acknowledgement', async () => {
    const { recordSarFilingStatus, reports, auditRecorder } = build();
    const id = await seed(reports, 'APPROVED');

    const filed = await recordSarFilingStatus({
      auth: SUPERVISOR,
      sarReportId: id,
      filing: {
        outcome: 'FILED',
        bsaIdentifier: BSA_ID,
        filedAt: FILED_AT,
        acknowledgementReference: 'ACK-2026-0042',
      },
    });

    expect(filed.status).toBe('FILED');
    expect(filed.bsaIdentifier).toBe(BSA_ID);
    expect(filed.filedAt).toEqual(FILED_AT);
    expect(filed.filedBy).toBe(oid('sup-2'));
    expect(filed.acknowledgementReference).toBe('ACK-2026-0042');
    expect(auditRecorder.all().map((e) => e.action)).toContain('RECORD_SAR_FILING_STATUS');
  });

  /*
   * La fecha la manda quien registra, no el reloj: el informe se presenta en
   * el sistema de FinCEN y se anota aqui despues, asi que la que vale es la
   * del acuse, no la del dia que alguien lo tecleo.
   */
  it('keeps the acknowledgement date, not the moment it was typed in', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');

    const filed = await recordSarFilingStatus({
      auth: SUPERVISOR,
      sarReportId: id,
      filing: { outcome: 'FILED', bsaIdentifier: BSA_ID, filedAt: FILED_AT },
    });

    expect(filed.filedAt).toEqual(FILED_AT);
    expect(filed.filedAt).not.toEqual(NOW);
  });

  it('refuses a filing dated in the future', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');

    await expect(
      recordSarFilingStatus({
        auth: SUPERVISOR,
        sarReportId: id,
        filing: {
          outcome: 'FILED',
          bsaIdentifier: BSA_ID,
          filedAt: fromDate(new Date('2027-01-01T00:00:00.000Z')),
        },
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
  });

  /* Un identificador mal formado lleva a ninguna parte cuando lo reclamen. */
  it('refuses a BSA identifier that is not 14 digits', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');

    await expect(
      recordSarFilingStatus({
        auth: SUPERVISOR,
        sarReportId: id,
        filing: { outcome: 'FILED', bsaIdentifier: '123', filedAt: FILED_AT },
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
  });

  it('refuses to file a report that was never approved', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'DRAFT');

    await expect(
      recordSarFilingStatus({
        auth: SUPERVISOR,
        sarReportId: id,
        filing: { outcome: 'FILED', bsaIdentifier: BSA_ID, filedAt: FILED_AT },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  /*
   * Una presentacion rechazada y una nunca enviada se distinguen: solo una de
   * las dos sigue debiendole un informe al regulador.
   */
  it('records a rejection with its reason', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');

    const rejected = await recordSarFilingStatus({
      auth: SUPERVISOR,
      sarReportId: id,
      filing: { outcome: 'REJECTED', reason: 'Subject TIN failed validation' },
    });

    expect(rejected.status).toBe('FILING_REJECTED');
    expect(rejected.filingRejectionReason).toBe('Subject TIN failed validation');
    expect(rejected.bsaIdentifier).toBeNull();
  });

  /* Reenviar tras un rechazo es el camino normal, y borra el rechazo previo. */
  it('lets a rejected report be filed again and clears the rejection', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');

    await recordSarFilingStatus({
      auth: SUPERVISOR,
      sarReportId: id,
      filing: { outcome: 'REJECTED', reason: 'Subject TIN failed validation' },
    });
    const filed = await recordSarFilingStatus({
      auth: SUPERVISOR,
      sarReportId: id,
      filing: { outcome: 'FILED', bsaIdentifier: BSA_ID, filedAt: FILED_AT },
    });

    expect(filed.status).toBe('FILED');
    expect(filed.filingRejectionReason).toBeNull();
  });

  /* Enmendar un informe presentado es un informe NUEVO, no una edicion. */
  it('refuses to touch a report that is already filed', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');
    await recordSarFilingStatus({
      auth: SUPERVISOR,
      sarReportId: id,
      filing: { outcome: 'FILED', bsaIdentifier: BSA_ID, filedAt: FILED_AT },
    });

    await expect(
      recordSarFilingStatus({
        auth: SUPERVISOR,
        sarReportId: id,
        filing: { outcome: 'FILED', bsaIdentifier: '31000099999999', filedAt: FILED_AT },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('rejects ANALYST', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');

    await expect(
      recordSarFilingStatus({
        auth: ANALYST,
        sarReportId: id,
        filing: { outcome: 'FILED', bsaIdentifier: BSA_ID, filedAt: FILED_AT },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('does not touch a report from another organization', async () => {
    const { recordSarFilingStatus, reports } = build();
    const id = await seed(reports, 'APPROVED');

    await expect(
      recordSarFilingStatus({
        auth: createAuthContext({
          userId: oid('sup-2'),
          organizationId: oid('org-2'),
          actorType: 'USER',
          roleId: 'SUPERVISOR',
        }),
        sarReportId: id,
        filing: { outcome: 'FILED', bsaIdentifier: BSA_ID, filedAt: FILED_AT },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
