import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { CaseReport } from '../domain/model/aggregates/CaseReport.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseReportRepository } from '../domain/ports/CaseReportRepository.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { EvidenceStore } from '../domain/ports/EvidenceStore.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import {
  caseNotFound,
  caseReportNotFound,
  forbiddenCrossTenant,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireReadRole, OVERSIGHT_READ_ROLES } from './authorization/policy.js';

/** One file inside the package. The zip packaging itself lives in infrastructure. */
export interface DossierEntry {
  readonly path: string;
  readonly bytes: Buffer;
}

export interface CaseAuditDossier {
  readonly caseId: string;
  readonly reportId: string;
  readonly entries: readonly DossierEntry[];
  readonly generatedAt: Instant;
  /**
   * Evidence items whose blob could not be retrieved from storage. The dossier
   * is still delivered, but the manifest flags them: a package that silently
   * omits a proof is worse than one that says so.
   */
  readonly missingEvidenceIds: readonly string[];
}

export interface GenerateCaseAuditDossierInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  /** Specific report. Defaults to the most recent one for the case. */
  readonly reportId?: string;
}

export interface GenerateCaseAuditDossierDeps {
  readonly cases: CaseRepository;
  readonly reports: CaseReportRepository;
  readonly evidence: EvidenceRepository;
  readonly evidenceStore: EvidenceStore;
  readonly timelineRecorder: TimelineRecorder;
  readonly renderReportPdf: (report: CaseReport) => Promise<Buffer>;
  readonly clock: Clock;
}

/**
 * INV-016 — case audit dossier.
 *
 * GET /cases/:caseId/dossier
 *
 * Packages what must be delivered to a court or a regulator: the frozen report
 * (JSON and PDF), the full timeline, every evidence file with its hash, and
 * the RFC 3161 timestamps in their original binary format.
 *
 * Timestamps are written as raw `.tsr` files, decoded from the base64 they
 * are stored in. That is what `openssl ts -verify` expects, so the recipient
 * can check the stamps with standard tools without depending on anything of
 * ours — which is exactly what makes a dossier useful. A JSON with the token
 * inside would force the other party to write a script before they could
 * verify anything.
 *
 * Governance read: `OVERSIGHT_READ_ROLES`. A dossier takes every proof of a
 * case out of the system in a single file, so it uses the same permission as
 * exports, not the one of the analyst who works the case.
 */
export function createGenerateCaseAuditDossierUseCase(deps: GenerateCaseAuditDossierDeps) {
  return async function generateCaseAuditDossier(
    input: GenerateCaseAuditDossierInput,
  ): Promise<CaseAuditDossier> {
    requireReadRole(input.auth, OVERSIGHT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }

    const report = await resolveReport(deps, caseId, input.reportId);
    const [timeline, evidenceItems] = await Promise.all([
      deps.timelineRecorder.listByCaseId(caseId),
      deps.evidence.listByCaseId(caseId),
    ]);

    const generatedAt = deps.clock.now();
    const entries: DossierEntry[] = [
      {
        path: 'informe/expediente.json',
        bytes: Buffer.from(JSON.stringify(report.snapshot, null, 2), 'utf8'),
      },
      { path: 'informe/expediente.pdf', bytes: await deps.renderReportPdf(report) },
      {
        path: 'cronologia.json',
        bytes: Buffer.from(
          JSON.stringify(
            timeline.map((event) => ({
              id: event.id,
              eventType: event.eventType,
              previousValue: event.previousValue,
              newValue: event.newValue,
              createdBy: event.createdBy,
              createdAt: event.createdAt,
            })),
            null,
            2,
          ),
          'utf8',
        ),
      },
    ];

    const missingEvidenceIds: string[] = [];
    const manifest: Record<string, unknown>[] = [];

    for (const item of evidenceItems) {
      const safeName = `${item.id}-${sanitize(item.filename)}`;
      const bytes = await deps.evidenceStore.get(item.storageKey);

      if (bytes === null) {
        missingEvidenceIds.push(item.id);
      } else {
        entries.push({ path: `evidencias/${safeName}`, bytes });
      }

      if (item.timestamp !== null) {
        entries.push({
          path: `sellos/${item.id}.tsr`,
          bytes: Buffer.from(item.timestamp.token, 'base64'),
        });
      }

      manifest.push({
        evidenceId: item.id,
        filename: item.filename,
        packagedAs: bytes === null ? null : `evidencias/${safeName}`,
        contentType: item.contentType,
        byteSize: item.byteSize,
        sha256: item.sha256,
        scanStatus: item.scanStatus,
        uploadedBy: item.uploadedBy,
        createdAt: item.createdAt,
        deletedAt: item.deletedAt,
        timestamp:
          item.timestamp === null
            ? null
            : {
                authority: item.timestamp.authority,
                timestampedAt: item.timestamp.timestampedAt,
                tokenFile: `sellos/${item.id}.tsr`,
              },
        blobMissing: bytes === null,
      });
    }

    entries.push({
      path: 'evidencias/manifiesto.json',
      bytes: Buffer.from(
        JSON.stringify(
          { caseId, reportId: report.id, generatedAt, evidence: manifest },
          null,
          2,
        ),
        'utf8',
      ),
    });
    entries.push({ path: 'LEEME.txt', bytes: Buffer.from(readme(caseId, report.id), 'utf8') });

    return { caseId, reportId: report.id, entries, generatedAt, missingEvidenceIds };
  };
}

async function resolveReport(
  deps: GenerateCaseAuditDossierDeps,
  caseId: string,
  reportId: string | undefined,
): Promise<CaseReport> {
  const reports = await deps.reports.listByCaseId(createCaseId(caseId));
  if (reports.length === 0) {
    // Without a frozen report there is no dossier: the package is built AROUND
    // the immutable snapshot, and assembling it from live data would yield a
    // legal document that changes depending on when it was requested.
    throw caseReportNotFound(reportId ?? caseId);
  }
  if (reportId === undefined) {
    return reports[reports.length - 1]!;
  }
  const found = reports.find((report) => report.id === reportId);
  if (found === undefined) {
    throw caseReportNotFound(reportId);
  }
  return found;
}

/**
 * Safe name inside the ZIP.
 *
 * The original name was chosen by whoever uploaded the file, so it can carry
 * slashes or `..`: a careless decompressor would write outside the target
 * directory (zip-slip). Only harmless characters are kept, and the evidence
 * id goes in front, which also avoids collisions between two files with the
 * same name.
 */
function sanitize(filename: string): string {
  const cleaned = filename
    // Drop everything that is not harmless: slashes in particular, which are
    // what turn a name into a path.
    .replace(/[^A-Za-z0-9._-]/g, '_')
    // No `..` survives. Without slashes it is no longer exploitable, but a
    // decompressor that normalizes unusual separators could re-form them,
    // and a name with `..` inside a legal package invites questions that
    // there is no reason to raise.
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '');
  return cleaned === '' ? 'evidencia' : cleaned.slice(0, 100);
}

function readme(caseId: string, reportId: string): string {
  return [
    `Dossier de auditoria del expediente ${caseId}`,
    `Informe congelado: ${reportId}`,
    '',
    'Contenido',
    '  informe/expediente.json   Snapshot inmutable del expediente al cerrarse.',
    '  informe/expediente.pdf    El mismo snapshot en formato legible.',
    '  cronologia.json           Todos los hitos del expediente, en orden.',
    '  evidencias/               Los ficheros aportados como prueba.',
    '  evidencias/manifiesto.json  Hash SHA-256, antivirus y sello de cada uno.',
    '  sellos/<id>.tsr           Sello RFC 3161 en formato binario original.',
    '',
    'Como verificar una evidencia',
    '  1) Comprobar el hash del fichero:',
    '       sha256sum evidencias/<fichero>',
    '     y contrastarlo con el campo sha256 del manifiesto.',
    '',
    '  2) Comprobar el sello de tiempo sobre ese hash:',
    '       openssl ts -verify -token_in -in sellos/<id>.tsr \\',
    '           -digest <sha256> -CAfile <ca-de-la-autoridad>.pem',
    '',
    '     `-token_in` es obligatorio: el fichero .tsr contiene el',
    '     TimeStampToken a secas, no la respuesta completa de la autoridad.',
    '     Sin esa opcion openssl falla con un error de ASN.1.',
    '',
    '  3) Para leer la fecha del sello sin verificar la firma:',
    '       openssl ts -reply -token_in -in sellos/<id>.tsr -text',
    '',
    'Nota sobre el campo scanStatus del manifiesto',
    '  CLEAN   el antivirus analizo el fichero y no encontro nada.',
    '  SKIPPED nadie lo analizo. NO significa que este limpio.',
    '',
    'Si el manifiesto marca blobMissing en alguna entrada, ese fichero no',
    'estaba disponible en el almacen al generar el paquete y NO se incluye.',
  ].join('\n');
}
