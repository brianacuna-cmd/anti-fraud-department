import PDFDocument from 'pdfkit';
import type { CaseReport } from '../../../../../domain/model/aggregates/CaseReport.js';
import type { AnalystDecisionType } from '../../../../../domain/model/value-objects/AnalystDecisionType.js';
import type { AssignedToType } from '../../../../../domain/model/value-objects/AssignedTo.js';
import type { CasePriority } from '../../../../../domain/model/value-objects/CasePriority.js';
import type { CaseStatus } from '../../../../../domain/model/value-objects/CaseStatus.js';
import type { EnforcementActionStatus } from '../../../../../domain/model/value-objects/EnforcementActionStatus.js';
import type { EnforcementActionType } from '../../../../../domain/model/value-objects/EnforcementActionType.js';
import type { InvestigationStatus } from '../../../../../domain/model/value-objects/InvestigationStatus.js';
import type { InvestigationSubjectType } from '../../../../../domain/model/value-objects/InvestigationSubjectType.js';
import type { ResolutionClosureType } from '../../../../../domain/model/aggregates/Resolution.js';
import type { SlaStatus } from '../../../../../domain/model/value-objects/SlaStatus.js';
import type { TimelineEventType } from '../../../../../domain/model/value-objects/TimelineEventType.js';

const MARGIN = 48;
const INK = '#111111';
const MUTED = '#6b6b75';
const RULE = '#d8d8dd';

/** Ancho util de una pagina Letter con los margenes de arriba. */
const CONTENT_WIDTH = 612 - MARGIN * 2;

/**
 * Todo enum del dominio que puede acabar impreso en el informe.
 *
 * `Record<Translatable, string>` obliga al compilador a exigir el mapa
 * COMPLETO: si manana se anade un tipo de sancion o un hito de cronologia,
 * el build falla hasta que alguien decida como se llama en castellano. Sin
 * esto la traduccion se olvida en silencio y el valor sale crudo — que es
 * justo lo que paso con `FRAUD_CONFIRMED`, escrito aqui al reves como
 * `CONFIRMED_FRAUD`: el mapa parecia completo y el dictamen salia en ingles.
 */
type Translatable =
  | AnalystDecisionType
  | AssignedToType
  | CasePriority
  | CaseStatus
  | EnforcementActionStatus
  | EnforcementActionType
  | InvestigationStatus
  | InvestigationSubjectType
  | ResolutionClosureType
  | SlaStatus
  | TimelineEventType;

/**
 * Etiquetas en castellano.
 *
 * El snapshot guarda el valor del dominio (`IN_REVIEW`), que es lo correcto
 * —traducir en el guardado congelaria el idioma junto con los datos—, pero el
 * PDF lo lee una persona que a menudo no ha visto el sistema por dentro: un
 * regulador, un banco corresponsal, un juzgado. Un valor sin traduccion cae
 * en su forma cruda antes que desaparecer.
 */
const LABELS: Readonly<Record<Translatable, string>> = {
  // Estado del expediente
  OPEN: 'Abierto',
  IN_REVIEW: 'En revisión',
  RESOLVED: 'Resuelto',
  ARCHIVED: 'Archivado',
  // Prioridad
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
  // Eventos de la cronología
  CASE_CREATED: 'Expediente abierto',
  CASE_REOPENED: 'Expediente reabierto',
  STATE_CHANGED: 'Cambio de estado',
  NOTE_ADDED: 'Nota añadida',
  ASSIGNED: 'Asignación',
  DECISION_MADE: 'Dictamen registrado',
  EVIDENCE_ADDED: 'Evidencia adjuntada',
  EVIDENCE_DELETED: 'Evidencia retirada',
  NOTE_DELETED: 'Nota eliminada',
  PRIORITY_CHANGED: 'Cambio de prioridad',
  TAGS_UPDATED: 'Etiquetas actualizadas',
  CASE_LINKED_TO_INVESTIGATION: 'Vinculado a una investigación',
  SNAPSHOT_REFRESHED: 'Datos del cliente actualizados',
  ENFORCEMENT_REQUESTED: 'Medida cautelar solicitada',
  // Dictamen y cierre
  FRAUD_CONFIRMED: 'Fraude confirmado',
  FALSE_POSITIVE: 'Falso positivo',
  INCONCLUSIVE: 'No concluyente',
  // Sanciones
  BLOCK: 'Bloqueo',
  RESTRICT: 'Restricción',
  SUSPEND: 'Suspensión',
  DELETE: 'Eliminación',
  REVIEW: 'Revisión',
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  EXECUTED: 'Ejecutada',
  REVERTED: 'Revertida',
  // Estado del SLA
  ON_TRACK: 'En plazo',
  WARNING: 'Cerca de vencer',
  BREACHED: 'Vencido',
  // Investigaciones (OPEN y RESOLVED comparten clave con el expediente)
  INVESTIGATING: 'En curso',
  CLOSED: 'Cerrada',
  CUSTOMER: 'Cliente',
  WALLET: 'Wallet',
  EMAIL: 'Correo',
  USER: 'Usuario',
  ROLE: 'Rol',
};

/**
 * Cada bloque del expediente congelado: como se titula, de que clave del
 * snapshot sale y como se resume cada fila en una linea.
 *
 * En orden narrativo —que paso, quien lo dijo, que se investigo, que se
 * decidio, que se ejecuto y como acabo— y no en el orden en que el snapshot
 * guarda las claves: el informe lo lee una persona, normalmente alguien
 * ajeno al caso.
 */
/**
 * `actor(id)` traduce un id a la persona que era EN EL MOMENTO de congelar:
 * el mapa `actors` viaja dentro del snapshot. Un id que no esta en el mapa se
 * imprime crudo antes que atribuirle a nadie lo que hizo.
 */
type LineContext = { actor: (value: unknown) => string };

const SECTIONS: readonly {
  key: string;
  title: string;
  line: (row: Record<string, unknown>, ctx: LineContext) => readonly [string, string];
}[] = [
  {
    key: 'timeline',
    title: 'Cronología',
    line: (row, ctx) => [
      label(row.eventType),
      [
        // `->` y no `→`: la Helvetica base de pdfkit no lleva la flecha
        // Unicode y la imprimia como dos caracteres sueltos sin sentido.
        [label(row.previousValue), label(row.newValue)].filter(Boolean).join(' -> '),
        ctx.actor(row.createdBy),
        date(row.createdAt),
      ]
        .filter(Boolean)
        .join(' · '),
    ],
  },
  {
    key: 'notes',
    title: 'Notas',
    line: (row, ctx) => [
      [ctx.actor(row.authorId), date(row.createdAt)].filter(Boolean).join(' · '),
      str(row.body),
    ],
  },
  {
    key: 'evidence',
    title: 'Evidencia',
    line: (row, ctx) => [
      `${str(row.filename)}${row.deletedAt ? ' (retirada)' : ''}`,
      [
        `SHA-256 ${str(row.sha256)}`,
        size(row.byteSize),
        seal(row.timestamp),
        ctx.actor(row.uploadedBy),
        date(row.createdAt),
      ]
        .filter(Boolean)
        .join(' · '),
    ],
  },
  {
    key: 'investigations',
    title: 'Investigaciones',
    line: (row, ctx) => [
      `${label(row.subjectType)}: ${str(row.subjectId)} · ${label(row.status)}`,
      [str(row.findings) || '—', ctx.actor(row.openedBy)].filter(Boolean).join(' · '),
    ],
  },
  {
    key: 'analystDecisions',
    title: 'Dictámenes',
    line: (row, ctx) => [
      `${label(row.decision)} · confianza ${str(row.confidence)}`,
      [str(row.comment) || '—', ctx.actor(row.createdBy), date(row.createdAt)]
        .filter(Boolean)
        .join(' · '),
    ],
  },
  {
    key: 'enforcementActions',
    title: 'Acciones de cumplimiento',
    line: (row, ctx) => [
      `${label(row.actionType)} · ${label(row.status)}`,
      [`${label(row.targetType)}: ${str(row.targetId)}`, ctx.actor(row.createdBy)]
        .filter(Boolean)
        .join(' · '),
    ],
  },
  {
    key: 'approvals',
    title: 'Doble firma',
    line: (row, ctx) => [
      `${label(row.actionType)} · ${label(row.status)}`,
      [
        `Solicita ${ctx.actor(row.requesterId) || str(row.requesterId)}`,
        row.reviewerId ? `autoriza ${ctx.actor(row.reviewerId) || str(row.reviewerId)}` : 'sin revisar',
        str(row.reviewerComment),
        date(row.reviewedAt),
      ]
        .filter((part) => part && part !== '—')
        .join(' · '),
    ],
  },
  {
    key: 'resolutions',
    title: 'Resolución',
    line: (row, ctx) => [
      label(row.closureType),
      [str(row.reason) || '—', ctx.actor(row.resolvedBy), date(row.createdAt)]
        .filter(Boolean)
        .join(' · '),
    ],
  },
];

/**
 * Renderiza un informe congelado como PDF.
 *
 * Un informe existe para salir de la aplicación —a un regulador, a un banco
 * corresponsal, a un expediente judicial—, así que lo que se dibuja aquí es
 * el snapshot y NADA más: releer el caso vivo para completar huecos
 * destruiría justamente la propiedad que hace útil al informe, que es contar
 * el expediente tal y como estaba en el instante en que se congeló.
 *
 * pdfkit y no un navegador headless, igual que `PdfCaseExportRenderer`: es
 * JS puro y no arrastra un Chromium al despliegue.
 */
export class CaseReportPdfRenderer {
  readonly contentType = 'application/pdf';

  async render(report: CaseReport): Promise<Buffer> {
    const snapshot = report.snapshot as Record<string, unknown>;
    const kase = record(snapshot.case);
    const ctx: LineContext = { actor: actorLookup(snapshot.actors) };

    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.header(doc, report, kase, ctx);
    this.caseSummary(doc, kase, record(snapshot.sla), ctx);

    for (const section of SECTIONS) {
      const rows = list(snapshot[section.key]);
      this.section(doc, section.title, rows.length);
      if (rows.length === 0) {
        this.muted(doc, 'Sin registros.');
        continue;
      }
      for (const row of rows) {
        const [lead, detail] = section.line(row, ctx);
        this.entry(doc, lead, detail);
      }
    }

    this.footer(doc, report);
    doc.end();
    return done;
  }

  private header(
    doc: PDFKit.PDFDocument,
    report: CaseReport,
    kase: Record<string, unknown>,
    ctx: LineContext,
  ): void {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text('Informe de expediente');
    doc.moveDown(0.25);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Expediente ${str(kase.id) || report.caseId}`)
      .text(`Informe ${report.id} · congelado el ${date(report.createdAt)}`)
      .text(`Generado por ${ctx.actor(report.generatedBy) || report.generatedBy}`);
    this.rule(doc, 0.8);
  }

  private caseSummary(
    doc: PDFKit.PDFDocument,
    kase: Record<string, unknown>,
    sla: Record<string, unknown>,
    ctx: LineContext,
  ): void {
    this.section(doc, 'Expediente', null);
    for (const [name, value] of [
      ['Estado', label(kase.status)],
      ['Prioridad', label(kase.priority)],
      ['Riesgo', str(kase.riskScore)],
      ['Responsable', assignee(kase.assignedTo, ctx)],
      ['Plazo (SLA)', [date(kase.dueDate), label(sla.status)].filter(Boolean).join(' · ')],
      ['Etiquetas', strings(kase.tags).join(', ') || '—'],
      ['Abierto', date(kase.createdAt)],
    ] as const) {
      this.entry(doc, name, value || '—');
    }

    this.customer(doc, kase);
  }

  /**
   * Quien es el cliente, tal y como estaba congelado.
   *
   * Sin este bloque el informe identifica al sujeto por un `customerId`
   * interno que no le dice nada a quien lo lee desde fuera — que es
   * exactamente el lector para el que existe el documento.
   */
  private customer(doc: PDFKit.PDFDocument, kase: Record<string, unknown>): void {
    const customer = record(kase.customer);
    this.section(doc, 'Cliente', null);
    for (const [name, value] of [
      ['Identificador', str(kase.customerId)],
      ['Correo', str(customer.email)],
      ['Usuario Bridge', str(customer.bridgeUserId)],
      ['Wallet Bridge', str(customer.bridgeWallet)],
      ['Cliente Stripe', str(customer.stripeCustomerId)],
    ] as const) {
      if (value) {
        this.entry(doc, name, value);
      }
    }
  }

  /**
   * Titulo de bloque. Reserva sitio para el titulo Y su primera fila antes de
   * decidir si cabe: sin eso un bloque puede quedar como ultima linea de una
   * pagina y su contenido empezar en la siguiente, huerfano.
   */
  private section(doc: PDFKit.PDFDocument, title: string, count: number | null): void {
    this.ensureSpace(doc, 56);
    doc.moveDown(0.7);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(INK)
      .text(count === null ? title : `${title} (${count})`);
    this.rule(doc, 0.35);
  }

  private entry(doc: PDFKit.PDFDocument, lead: string, detail: string): void {
    this.ensureSpace(doc, 34);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(lead, { width: CONTENT_WIDTH });
    if (detail && detail !== lead) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(detail, { width: CONTENT_WIDTH });
    }
    doc.moveDown(0.3);
  }

  private muted(doc: PDFKit.PDFDocument, text: string): void {
    this.ensureSpace(doc, 20);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(text);
  }

  private rule(doc: PDFKit.PDFDocument, gap: number): void {
    doc.moveDown(gap);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + CONTENT_WIDTH, doc.y)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.5);
  }

  private ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > doc.page.height - MARGIN) {
      doc.addPage();
    }
  }

  private footer(doc: PDFKit.PDFDocument, report: CaseReport): void {
    this.ensureSpace(doc, 40);
    doc.moveDown(1);
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Documento inmutable generado a partir del informe ${report.id}. Refleja el expediente ${report.caseId} tal y como estaba el ${date(report.createdAt)}; el expediente puede haber cambiado desde entonces.`,
        { width: CONTENT_WIDTH },
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Lectura defensiva del snapshot                                              */
/* -------------------------------------------------------------------------- */

/**
 * El snapshot es `Record<string, unknown>` a proposito —congela lo que habia,
 * y lo que habia hace seis meses puede no tener la forma de hoy—, asi que
 * cada lectura tolera que la clave falte o venga de otro tipo. Un informe
 * antiguo tiene que seguir imprimiendose.
 */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((entry) => record(entry)) : [];
}

/** Las etiquetas son cadenas sueltas, no filas: `list` las convertiria en `{}`. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => str(entry)).filter((entry) => entry.length > 0) : [];
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function date(value: unknown): string {
  const raw = str(value);
  if (raw.length === 0) return '—';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().replace('T', ' ').slice(0, 16);
}

function assignee(value: unknown, ctx: LineContext): string {
  const target = record(value);
  const id = str(target.id);
  if (id.length === 0) return 'Sin asignar';
  return `${label(target.type) || 'Usuario'}: ${ctx.actor(id) || id}`;
}

/**
 * Buscador de nombres sobre el mapa `actors` del snapshot. Devuelve cadena
 * vacia cuando no hay nombre, para que quien llama decida si cae al id o si
 * omite el dato.
 */
function actorLookup(value: unknown): (id: unknown) => string {
  const actors = record(value);
  return (id: unknown) => {
    const key = str(id);
    const name = actors[key];
    return typeof name === 'string' ? name : '';
  };
}

/** Tamaño legible del fichero de evidencia. */
function size(value: unknown): string {
  const bytes = typeof value === 'number' ? value : Number(str(value));
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * El sello RFC 3161, si lo hay. Que se diga explicitamente cuando NO lo hay
 * importa: una prueba sin sello vale menos ante un tercero, y callarlo en el
 * informe seria sugerir lo contrario.
 */
function seal(value: unknown): string {
  const timestamp = record(value);
  const authority = str(timestamp.authority);
  return authority.length === 0
    ? 'sin sello de tiempo'
    : `sellada por ${authority} el ${date(timestamp.timestampedAt)}`;
}

/** Traduce un enum del dominio; sin traduccion, devuelve el valor crudo. */
function label(value: unknown): string {
  const raw = str(value);
  // El snapshot es historico: puede traer un valor que ya no existe en el
  // enum de hoy. Se imprime crudo antes que perderse.
  return (LABELS as Record<string, string>)[raw] ?? raw;
}
