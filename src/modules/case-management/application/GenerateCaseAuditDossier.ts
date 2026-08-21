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

/** Un fichero dentro del paquete. El empaquetado en sí vive en infraestructura. */
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
   * Evidencias cuyo blob no se pudo recuperar del almacén. El dossier se
   * entrega igualmente, pero el manifiesto las marca: un paquete al que le
   * falta una prueba en silencio es peor que uno que lo dice.
   */
  readonly missingEvidenceIds: readonly string[];
}

export interface GenerateCaseAuditDossierInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  /** Informe concreto. Por defecto, el más reciente del expediente. */
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
 * INV-016 — dossier de auditoría del expediente.
 *
 * GET /cases/:caseId/dossier
 *
 * Empaqueta lo que hay que entregar a un juzgado o a un regulador: el informe
 * congelado (JSON y PDF), la cronología completa, cada fichero de evidencia
 * con su hash, y los sellos RFC 3161 en su formato binario original.
 *
 * Los sellos se escriben como `.tsr` crudos, decodificados del base64 en que
 * se guardan. Es lo que espera `openssl ts -verify`, así que el destinatario
 * puede comprobar los sellos con herramientas estándar sin depender de nada
 * nuestro — que es justamente lo que hace útil a un dossier. Un JSON con el
 * token dentro obligaría a la otra parte a escribir un script antes de poder
 * verificar nada.
 *
 * Lectura de gobierno: `OVERSIGHT_READ_ROLES`. Un dossier saca del sistema
 * todas las pruebas de un expediente en un solo fichero, así que va con el
 * mismo permiso que las exportaciones, no con el del analista que instruye.
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
    // Sin informe congelado no hay dossier: el paquete se construye ALREDEDOR
    // del snapshot inmutable, y armarlo con datos vivos daría un documento
    // legal que cambia según cuándo se pidió.
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
 * Nombre seguro dentro del ZIP.
 *
 * El nombre original lo eligió quien subió el fichero, así que puede traer
 * barras o `..`: un descompresor descuidado escribiría fuera del directorio de
 * destino (zip-slip). Se queda solo con caracteres inocuos y el id de la
 * evidencia va delante, que además evita colisiones entre dos ficheros
 * llamados igual.
 */
function sanitize(filename: string): string {
  const cleaned = filename
    // Fuera todo lo que no sea inocuo: en particular las barras, que son lo
    // que convierte un nombre en una ruta.
    .replace(/[^A-Za-z0-9._-]/g, '_')
    // Ningun `..` sobrevive. Sin barras ya no es explotable, pero un
    // descompresor que normalice separadores raros podria volver a formarlas,
    // y un nombre con `..` dentro de un paquete legal invita a preguntas que
    // no hay por que provocar.
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
    '       openssl ts -verify -digest <sha256> \\',
    '           -in sellos/<id>.tsr -CAfile <ca-de-la-autoridad>.pem',
    '',
    'Nota sobre el campo scanStatus del manifiesto',
    '  CLEAN   el antivirus analizo el fichero y no encontro nada.',
    '  SKIPPED nadie lo analizo. NO significa que este limpio.',
    '',
    'Si el manifiesto marca blobMissing en alguna entrada, ese fichero no',
    'estaba disponible en el almacen al generar el paquete y NO se incluye.',
  ].join('\n');
}
