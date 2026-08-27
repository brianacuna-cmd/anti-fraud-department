import JSZip from 'jszip';
import { oid } from '../../../support/oid.js';
import { createGenerateCaseAuditDossierUseCase } from '../../../../src/modules/case-management/application/GenerateCaseAuditDossier.js';
import { DossierZipPacker } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/report/DossierZipPacker.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseReport } from '../../../../src/modules/case-management/domain/model/aggregates/CaseReport.js';
import { Evidence } from '../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { CaseTimelineEvent } from '../../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createCaseReportId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';
import { createEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseReportRepository } from '../../../helpers/case-management/InMemoryCaseReportRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryEvidenceStore } from '../../../helpers/case-management/InMemoryEvidenceStore.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const CASE_ID = createCaseId(oid('case-1'));
const REPORT_ID = createCaseReportId(oid('report-1'));
const EVIDENCE_ID = createEvidenceId(oid('ev-1'));
const STORAGE_KEY = 'org/case/ev-1';
const TOKEN_BYTES = Buffer.from([0x30, 0x03, 0x02, 0x01, 0x2a]);

const SUPERVISOR = createAuthContext({
  userId: oid('supervisor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function buildCase(organizationId = ORG_1): Case {
  return Case.create({
    id: CASE_ID,
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(80),
    priority: 'HIGH',
    now: NOW,
  });
}

function buildEvidence(withTimestamp: boolean, filename = 'extracto.pdf'): Evidence {
  return Evidence.register({
    id: EVIDENCE_ID,
    caseId: CASE_ID,
    investigationId: null,
    organizationId: ORG_1,
    filename,
    contentType: 'application/pdf',
    byteSize: 5,
    sha256: 'a'.repeat(64),
    storageKey: STORAGE_KEY,
    timestamp: withTimestamp
      ? { token: TOKEN_BYTES.toString('base64'), authority: 'FreeTSA', timestampedAt: NOW }
      : null,
    scanStatus: 'CLEAN',
    uploadedBy: oid('analyst-1'),
    now: NOW,
  });
}

function setup() {
  const cases = new InMemoryCaseRepository();
  const reports = new InMemoryCaseReportRepository();
  const evidence = new InMemoryEvidenceRepository();
  const evidenceStore = new InMemoryEvidenceStore();
  const timelineRecorder = new InMemoryTimelineRecorder();

  const dossier = createGenerateCaseAuditDossierUseCase({
    cases,
    reports,
    evidence,
    evidenceStore,
    timelineRecorder,
    renderReportPdf: async () => Buffer.from('%PDF-1.7 fake', 'utf8'),
    clock: new FixedClock(NOW),
  });

  return { cases, reports, evidence, evidenceStore, timelineRecorder, dossier };
}

async function seedReport(reports: InMemoryCaseReportRepository) {
  await reports.save(
    CaseReport.create({
      id: REPORT_ID,
      caseId: CASE_ID,
      organizationId: ORG_1,
      generatedBy: oid('supervisor-1'),
      snapshot: { case: { id: CASE_ID, status: 'RESOLVED' } },
      now: NOW,
    }),
  );
}

function pathsOf(entries: readonly { path: string }[]): string[] {
  return entries.map((entry) => entry.path);
}

describe('GenerateCaseAuditDossier (INV-016)', () => {
  it('empaqueta informe, cronología, evidencias, sellos y manifiesto', async () => {
    const { cases, reports, evidence, evidenceStore, timelineRecorder, dossier } = setup();
    await cases.save(buildCase());
    await seedReport(reports);
    await evidence.save(buildEvidence(true));
    await evidenceStore.put(STORAGE_KEY, Buffer.from('bytes'));
    await timelineRecorder.record(
      CaseTimelineEvent.create({
        id: generateTimelineEventId(),
        caseId: CASE_ID,
        eventType: 'CASE_CREATED',
        previousValue: null,
        newValue: 'OPEN',
        createdBy: oid('analyst-1'),
        createdAt: NOW,
      }),
    );

    const result = await dossier({ auth: SUPERVISOR, caseId: CASE_ID });
    const paths = pathsOf(result.entries);

    expect(paths).toContain('informe/expediente.json');
    expect(paths).toContain('informe/expediente.pdf');
    expect(paths).toContain('cronologia.json');
    expect(paths).toContain('evidencias/manifiesto.json');
    expect(paths).toContain('LEEME.txt');
    expect(paths).toContain(`evidencias/${EVIDENCE_ID}-extracto.pdf`);
    expect(paths).toContain(`sellos/${EVIDENCE_ID}.tsr`);
    expect(result.missingEvidenceIds).toEqual([]);
  });

  it('escribe el sello como binario crudo, no como base64', async () => {
    const { cases, reports, evidence, evidenceStore, dossier } = setup();
    await cases.save(buildCase());
    await seedReport(reports);
    await evidence.save(buildEvidence(true));
    await evidenceStore.put(STORAGE_KEY, Buffer.from('bytes'));

    const result = await dossier({ auth: SUPERVISOR, caseId: CASE_ID });
    const seal = result.entries.find((entry) => entry.path.endsWith('.tsr'));

    // `openssl ts -verify` espera el DER; un base64 obligaria al destinatario
    // a escribir un script antes de poder verificar nada.
    expect(seal!.bytes.equals(TOKEN_BYTES)).toBe(true);
  });

  it('entrega el paquete y marca la evidencia cuyo blob falta', async () => {
    const { cases, reports, evidence, dossier } = setup();
    await cases.save(buildCase());
    await seedReport(reports);
    await evidence.save(buildEvidence(false));
    // On purpose: the blob is not stored in the store.

    const result = await dossier({ auth: SUPERVISOR, caseId: CASE_ID });
    const manifest = JSON.parse(
      result.entries.find((entry) => entry.path === 'evidencias/manifiesto.json')!.bytes.toString(),
    ) as { evidence: { blobMissing: boolean; packagedAs: string | null }[] };

    expect(result.missingEvidenceIds).toEqual([EVIDENCE_ID]);
    expect(manifest.evidence[0]!.blobMissing).toBe(true);
    expect(manifest.evidence[0]!.packagedAs).toBeNull();
    expect(pathsOf(result.entries)).not.toContain(`evidencias/${EVIDENCE_ID}-extracto.pdf`);
  });

  it('neutraliza nombres de fichero peligrosos', async () => {
    const { cases, reports, evidence, evidenceStore, dossier } = setup();
    await cases.save(buildCase());
    await seedReport(reports);
    await evidence.save(buildEvidence(false, '../../etc/passwd'));
    await evidenceStore.put(STORAGE_KEY, Buffer.from('bytes'));

    const result = await dossier({ auth: SUPERVISOR, caseId: CASE_ID });
    const packaged = pathsOf(result.entries).find((path) => path.startsWith('evidencias/') && !path.endsWith('manifiesto.json'));

    // Zip-slip: el nombre lo eligio quien subio el fichero.
    expect(packaged).not.toContain('..');
    expect(packaged).toBe(`evidencias/${EVIDENCE_ID}-etc_passwd`);
  });

  it('exige un informe congelado', async () => {
    const { cases, dossier } = setup();
    await cases.save(buildCase());

    // El paquete se construye ALREDEDOR del snapshot inmutable; armarlo con
    // datos vivos daria un documento legal que cambia segun cuando se pidio.
    await expect(dossier({ auth: SUPERVISOR, caseId: CASE_ID })).rejects.toThrow(
      CaseManagementError,
    );
  });

  it('rechaza al analista: es lectura de gobierno', async () => {
    const { cases, reports, dossier } = setup();
    await cases.save(buildCase());
    await seedReport(reports);

    // A dossier pulls ALL of the case's evidence into a single file.
    await expect(dossier({ auth: ANALYST, caseId: CASE_ID })).rejects.toThrow(CaseManagementError);
  });

  it('no cruza inquilinos', async () => {
    const { cases, reports, dossier } = setup();
    await cases.save(buildCase(ORG_2));
    await seedReport(reports);

    await expect(dossier({ auth: SUPERVISOR, caseId: CASE_ID })).rejects.toThrow(/does not belong/);
  });
});

describe('DossierZipPacker', () => {
  it('produce un ZIP legible con las rutas del dossier', async () => {
    const packer = new DossierZipPacker();
    const bytes = await packer.pack({
      caseId: CASE_ID,
      reportId: REPORT_ID,
      entries: [{ path: 'LEEME.txt', bytes: Buffer.from('hola') }],
      generatedAt: NOW,
      missingEvidenceIds: [],
    });

    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('LEEME.txt')!.async('string')).toBe('hola');
  });

  it('es reproducible: el mismo dossier da los mismos bytes', async () => {
    const packer = new DossierZipPacker();
    const dossier = {
      caseId: CASE_ID,
      reportId: REPORT_ID,
      entries: [{ path: 'LEEME.txt', bytes: Buffer.from('hola') }],
      generatedAt: NOW,
      missingEvidenceIds: [],
    };

    // Sin fecha fija, JSZip sella cada entrada con la hora de generacion y el
    // hash del paquete cambia en cada peticion — con lo que no se puede
    // referenciar por hash en un escrito.
    const a = await packer.pack(dossier);
    const b = await packer.pack(dossier);
    expect(a.equals(b)).toBe(true);
  });
});
