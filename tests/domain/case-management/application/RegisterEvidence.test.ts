import { createHash } from 'node:crypto';
import { oid } from '../../../support/oid.js';
import { createRegisterEvidenceUseCase } from '../../../../src/modules/case-management/application/RegisterEvidence.js';
import { createListEvidenceUseCase } from '../../../../src/modules/case-management/application/ListEvidence.js';
import { createGetEvidenceUseCase } from '../../../../src/modules/case-management/application/GetEvidence.js';
import { createDownloadEvidenceUseCase } from '../../../../src/modules/case-management/application/DownloadEvidence.js';
import { createOpenInvestigationUseCase } from '../../../../src/modules/case-management/application/OpenInvestigation.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { generateInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import type { TimestampAuthority } from '../../../../src/modules/case-management/domain/ports/TimestampAuthority.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryEvidenceStore } from '../../../helpers/case-management/InMemoryEvidenceStore.js';
import { FakeMalwareScanner } from '../../../helpers/case-management/FakeMalwareScanner.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

const nullTsa: TimestampAuthority = { requestTimestamp: async () => null };

function buildCase(organizationId = ORG_1): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    // Assignment rule freezes orphan cases:
    // without an owner they cannot be worked.
    assignedTo: createAssignedTo('USER', oid('analyst-1')),
    now: NOW,
  });
}

function build(tsa: TimestampAuthority = nullTsa, malwareScanner = new FakeMalwareScanner()) {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const evidence = new InMemoryEvidenceRepository();
  const evidenceStore = new InMemoryEvidenceStore();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const deps = {
    cases,
    investigations,
    evidence,
    evidenceStore,
    timestampAuthority: tsa,
    malwareScanner,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateEvidenceId,
    generateTimelineEventId,
  };
  return {
    cases,
    investigations,
    evidence,
    evidenceStore,
    timelineRecorder,
    auditRecorder,
    malwareScanner,
    registerEvidence: createRegisterEvidenceUseCase(deps),
    listEvidence: createListEvidenceUseCase({ cases, evidence }),
    getEvidence: createGetEvidenceUseCase({ evidence }),
    downloadEvidence: createDownloadEvidenceUseCase({ evidence, evidenceStore }),
    openInvestigation: createOpenInvestigationUseCase({
      cases,
      investigations,
      auditRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateInvestigationId,
    }),
  };
}

describe('createRegisterEvidenceUseCase', () => {
  it('computes SHA256 server-side, stores the blob, persists metadata + REGISTER_EVIDENCE audit', async () => {
    const h = build();
    await h.cases.save(buildCase());
    const bytes = Buffer.from('a fraudulent invoice PDF');

    const evidence = await h.registerEvidence({
      auth: ANALYST,
      caseId: oid('case-1'),
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      bytes,
    });

    const expectedHash = createHash('sha256').update(bytes).digest('hex');
    expect(evidence.sha256).toBe(expectedHash);
    expect(evidence.byteSize).toBe(bytes.length);
    expect(evidence.timestamp).toBeNull();
    expect(await h.evidenceStore.get(evidence.storageKey)).toEqual(bytes);
    expect(h.auditRecorder.all().some((a) => a.action === 'REGISTER_EVIDENCE')).toBe(true);
    const timeline = h.timelineRecorder.all();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('EVIDENCE_ADDED');
    expect(timeline[0]?.newValue).toBe(evidence.id);
  });

  it('records an RFC3161 timestamp when the TSA returns one', async () => {
    const stampingTsa: TimestampAuthority = {
      requestTimestamp: async () => ({ token: 'tok', authority: 'tsa.example', timestampedAt: NOW }),
    };
    const h = build(stampingTsa);
    await h.cases.save(buildCase());

    const evidence = await h.registerEvidence({
      auth: ANALYST,
      caseId: oid('case-1'),
      filename: 'x.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('x'),
    });

    expect(evidence.timestamp?.token).toBe('tok');
  });

  it('links evidence to a valid investigation of the same case', async () => {
    const h = build();
    await h.cases.save(buildCase());
    const investigation = await h.openInvestigation({
      auth: ANALYST,
      caseId: oid('case-1'),
      subjectType: 'WALLET',
      subjectId: 'w-1',
    });

    const evidence = await h.registerEvidence({
      auth: ANALYST,
      caseId: oid('case-1'),
      investigationId: investigation.id,
      filename: 'x.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('x'),
    });

    expect(evidence.investigationId).toBe(investigation.id);
  });

  it('throws caseNotFound when the case does not exist', async () => {
    const h = build();
    await expect(
      h.registerEvidence({ auth: ANALYST, caseId: oid('missing'), filename: 'x', contentType: 'text/plain', bytes: Buffer.from('x') }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
  });

  it('throws forbiddenCrossTenant for a case in another organization', async () => {
    const h = build();
    await h.cases.save(buildCase(ORG_2));
    await expect(
      h.registerEvidence({ auth: ANALYST, caseId: oid('case-1'), filename: 'x', contentType: 'text/plain', bytes: Buffer.from('x') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});

describe('read evidence', () => {
  it('lists, gets metadata, and downloads the blob (tenant-gated)', async () => {
    const h = build();
    await h.cases.save(buildCase());
    const bytes = Buffer.from('hello');
    const registered = await h.registerEvidence({
      auth: ANALYST,
      caseId: oid('case-1'),
      filename: 'h.txt',
      contentType: 'text/plain',
      bytes,
    });

    expect(await h.listEvidence({ auth: ANALYST, caseId: oid('case-1') })).toHaveLength(1);
    expect((await h.getEvidence({ auth: ANALYST, evidenceId: registered.id })).id).toBe(registered.id);
    const downloaded = await h.downloadEvidence({ auth: ANALYST, evidenceId: registered.id });
    expect(downloaded.bytes).toEqual(bytes);
    expect(downloaded.evidence.filename).toBe('h.txt');
  });

  it('getEvidence throws EVIDENCE_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(
      h.getEvidence({ auth: ANALYST, evidenceId: oid('missing') }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_NOT_FOUND' });
  });
});

describe('escaneo antivirus al registrar evidencia (INV-015)', () => {
  it('marca CLEAN cuando el escáner no encuentra nada', async () => {
    const h = build();
    await h.cases.save(buildCase());

    const evidence = await h.registerEvidence({
      auth: ANALYST,
      caseId: oid('case-1'),
      filename: 'extracto.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('contenido'),
    });

    expect(evidence.scanStatus).toBe('CLEAN');
    expect(h.malwareScanner.scanned).toHaveLength(1);
  });

  it('marca SKIPPED —no CLEAN— cuando no hay antivirus configurado', async () => {
    const scanner = new FakeMalwareScanner();
    scanner.setVerdict({ status: 'SKIPPED', reason: 'no malware scanner configured' });
    const h = build(nullTsa, scanner);
    await h.cases.save(buildCase());

    const evidence = await h.registerEvidence({
      auth: ANALYST,
      caseId: oid('case-1'),
      filename: 'extracto.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('contenido'),
    });

    // "Nadie lo miro" y "estaba limpio" son afirmaciones distintas.
    expect(evidence.scanStatus).toBe('SKIPPED');
  });

  it('rechaza el fichero infectado SIN guardarlo en ningún sitio', async () => {
    const scanner = new FakeMalwareScanner();
    scanner.setVerdict({ status: 'INFECTED', signature: 'Eicar-Test-Signature' });
    const h = build(nullTsa, scanner);
    await h.cases.save(buildCase());

    await expect(
      h.registerEvidence({
        auth: ANALYST,
        caseId: oid('case-1'),
        filename: 'malo.exe',
        contentType: 'application/octet-stream',
        bytes: Buffer.from('X5O!P%@AP'),
      }),
    ).rejects.toThrow(/Eicar-Test-Signature/);

    // Ni blob en el almacen ni fila de metadatos: no queda una copia de
    // malware en el bucket de evidencias esperando a que alguien la baje.
    expect(h.evidenceStore.all()).toHaveLength(0);
    expect(await h.evidence.listByCaseId(createCaseId(oid('case-1')))).toHaveLength(0);
  });

  it('audita el intento rechazado con la firma detectada', async () => {
    const scanner = new FakeMalwareScanner();
    scanner.setVerdict({ status: 'INFECTED', signature: 'Win.Trojan.Agent' });
    const h = build(nullTsa, scanner);
    await h.cases.save(buildCase());

    await expect(
      h.registerEvidence({
        auth: ANALYST,
        caseId: oid('case-1'),
        filename: 'malo.exe',
        contentType: 'application/octet-stream',
        bytes: Buffer.from('X5O!P%@AP'),
      }),
    ).rejects.toThrow();

    // The attempt itself is information: someone uploaded malware to the
    // case and that has to be written even though the file is rejected.
    const entry = h.auditRecorder.all().find((event) => event.detail.rejected === true);
    expect(entry).toBeDefined();
    expect(entry!.detail).toMatchObject({ signature: 'Win.Trojan.Agent', filename: 'malo.exe' });
  });
});
