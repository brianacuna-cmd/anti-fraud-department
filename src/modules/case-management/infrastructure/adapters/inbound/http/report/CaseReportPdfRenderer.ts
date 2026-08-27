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

/** Usable width of a Letter page with the margins above. */
const CONTENT_WIDTH = 612 - MARGIN * 2;

/**
 * Every domain enum that may end up printed in the report.
 *
 * `Record<Translatable, string>` forces the compiler to require the COMPLETE
 * map: if a sanction type or a timeline milestone is added tomorrow, the
 * build fails until someone decides what it is called in Spanish. Without
 * this the translation is forgotten silently and the raw value comes out —
 * which is exactly what happened with `FRAUD_CONFIRMED`, written here
 * backwards as `CONFIRMED_FRAUD`: the map looked complete and the decision
 * came out in English.
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
 * Labels in Spanish.
 *
 * The snapshot stores the domain value (`IN_REVIEW`), which is correct
 * —translating on save would freeze the language along with the data— but
 * the PDF is read by someone who often has not seen the system from the
 * inside: a regulator, a correspondent bank, a court. An untranslated
 * value falls back to its raw form rather than disappearing.
 */
const LABELS: Readonly<Record<Translatable, string>> = {
  // Case status
  OPEN: 'Abierto',
  IN_REVIEW: 'En revisión',
  RESOLVED: 'Resuelto',
  ARCHIVED: 'Archivado',
  // Priority
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
  // Timeline events
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
  // Decision and closure
  FRAUD_CONFIRMED: 'Fraude confirmado',
  FALSE_POSITIVE: 'Falso positivo',
  INCONCLUSIVE: 'No concluyente',
  // Sanctions
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
  // SLA status
  ON_TRACK: 'En plazo',
  WARNING: 'Cerca de vencer',
  BREACHED: 'Vencido',
  // Investigations (OPEN and RESOLVED share a key with the case)
  INVESTIGATING: 'En curso',
  CLOSED: 'Cerrada',
  CUSTOMER: 'Cliente',
  WALLET: 'Wallet',
  EMAIL: 'Correo',
  USER: 'Usuario',
  ROLE: 'Rol',
};

/**
 * Each block of the frozen case: how it is titled, which snapshot key it
 * comes from, and how each row is summarized into a line.
 *
 * In narrative order —what happened, who said it, what was investigated,
 * what was decided, what was executed and how it ended— and not in the
 * order the snapshot stores the keys: the report is read by a person,
 * usually someone outside the case.
 */
/**
 * `actor(id)` translates an id to the person they were AT THE MOMENT of
 * freeze: the `actors` map travels inside the snapshot. An id that is not
 * in the map is printed raw rather than attributing to anyone what they did.
 */
type LineContext = {
  actor: (value: unknown) => string;
  /** evidence id -> filename, resolved against the snapshot itself. */
  evidenceName: (id: string) => string | null;
};

/**
 * Readable detail of a timeline milestone.
 *
 * Several events store an IDENTIFIER in `newValue` —the evidence, the
 * note, the linked investigation— and the report used to print them raw: a
 * line that said «Nota anadida · 6a8acd5e55dd874d4afe713c», which tells
 * nothing to whoever reads the document from outside, which is exactly its
 * reader.
 *
 * Ids are resolved against the snapshot when possible, and when not, they
 * are omitted: the milestone, its author and its date already tell what
 * happened.
 */
function timelineDetail(row: Record<string, unknown>, ctx: LineContext): string {
  const type = str(row.eventType);

  if (type === 'EVIDENCE_ADDED') {
    return ctx.evidenceName(str(row.newValue)) ?? '';
  }
  // The note body comes out in full in its own section; repeating the id does
  // not help and repeating the text would duplicate half a page.
  if (type === 'NOTE_ADDED' || type === 'NOTE_DELETED' || type === 'EVIDENCE_DELETED') {
    return '';
  }
  if (type === 'ASSIGNED') {
    return ctx.actor(row.newValue);
  }
  if (type === 'CASE_LINKED_TO_INVESTIGATION') {
    return '';
  }

  return [label(row.previousValue), label(row.newValue)].filter(Boolean).join(' -> ');
}

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
        // `->` and not `→`: pdfkit's base Helvetica does not carry the Unicode
        // arrow and printed it as two loose characters that made no sense.
        timelineDetail(row, ctx),
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
 * Renders a frozen report as PDF.
 *
 * A report exists to leave the application —to a regulator, a correspondent
 * bank, a court file— so what is drawn here is the snapshot and NOTHING
 * else: re-reading the live case to fill gaps would destroy exactly the
 * property that makes the report useful, which is telling the case as it
 * stood at the instant it was frozen.
 *
 * pdfkit and not a headless browser, same as `PdfCaseExportRenderer`: it is
 * pure JS and does not drag a Chromium into the deployment.
 */
export class CaseReportPdfRenderer {
  readonly contentType = 'application/pdf';

  async render(report: CaseReport): Promise<Buffer> {
    const snapshot = report.snapshot as Record<string, unknown>;
    const kase = record(snapshot.case);
    const evidenceNames = new Map(
      list(snapshot.evidence).map((e) => [str(e.id), str(e.filename)]),
    );
    const ctx: LineContext = {
      actor: actorLookup(snapshot.actors),
      evidenceName: (id) => evidenceNames.get(id) ?? null,
    };

    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.header(doc, report, kase, ctx);
    this.verdict(doc, snapshot, kase, ctx);
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


  /**
   * Conclusion, at the very top.
   *
   * The report used to come out as a log: eight chronological sections that
   * had to be read in full to know how the case ended. Whoever opens it
   * —a regulator, a correspondent bank, a court— needs the outcome on the
   * first screen, and the detail afterwards as backing.
   *
   * Everything comes from the frozen snapshot itself: it queries nothing
   * live, so the summary ages the same as the rest of the document, which
   * is the correct thing for an immutable photograph.
   */
  private verdict(
    doc: PDFKit.PDFDocument,
    snapshot: Record<string, unknown>,
    kase: Record<string, unknown>,
    ctx: LineContext,
  ): void {
    const decisions = list(snapshot.analystDecisions);
    const actions = list(snapshot.enforcementActions);
    const resolutions = list(snapshot.resolutions);
    const evidence = list(snapshot.evidence);

    // The last decision is the one that counts: earlier ones remain as
    // history in their section, but the case verdict is the most recent.
    const lastDecision = decisions[decisions.length - 1];
    const closure = resolutions[resolutions.length - 1];
    const executed = actions.filter((a) => str(a.status) === 'EXECUTED');
    const sealed = evidence.filter((e) => e.timestamp !== null && e.timestamp !== undefined);

    this.section(doc, 'Conclusión', null);

    this.entry(
      doc,
      'Veredicto',
      lastDecision
        ? `${label(lastDecision.decision)} · confianza ${str(lastDecision.confidence)}%`
        : 'Sin dictamen registrado',
    );
    if (lastDecision && str(lastDecision.comment)) {
      this.entry(doc, 'Motivo', str(lastDecision.comment));
    }

    this.entry(
      doc,
      'Cierre',
      closure
        ? `${label(closure.closureType)} · ${ctx.actor(closure.resolvedBy)} · ${date(closure.createdAt)}`
        : 'Expediente sin cerrar al congelar este informe',
    );
    if (closure && str(closure.reason)) {
      this.entry(doc, 'Justificación', str(closure.reason));
    }

    this.entry(
      doc,
      'Medidas aplicadas',
      actions.length === 0
        ? 'Ninguna'
        : `${executed.length} de ${actions.length} ejecutadas` +
          (executed.length > 0
            ? ` (${executed.map((a) => label(a.actionType)).join(', ')})`
            : ' — el resto no llegó a aplicarse'),
    );

    /*
     * It says how many pieces are sealed and how many are not. Evidence
     * without an RFC 3161 seal still has its hash, but it has no date
     * opposable to a third party, and whoever receives the report has to see
     * that difference without counting the evidence section.
     */
    this.entry(
      doc,
      'Soporte probatorio',
      evidence.length === 0
        ? 'Sin evidencia adjunta'
        : `${evidence.length} pieza(s), ${sealed.length} con sello RFC 3161` +
          (sealed.length < evidence.length ? ' — el resto solo con hash' : ''),
    );

    this.rule(doc, 0.6);
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
   * Who the customer is, as they stood when frozen.
   *
   * Without this block the report identifies the subject by an internal
   * `customerId` that tells nothing to whoever reads it from outside — which
   * is exactly the reader the document exists for.
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
   * Block title. Reserves room for the title AND its first row before
   * deciding whether it fits: without that a block can sit as the last line
   * of a page and its content start on the next, orphaned.
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
/* Defensive snapshot reading                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The snapshot is `Record<string, unknown>` on purpose —it freezes what was
 * there, and what was there six months ago may not have today's shape— so
 * each read tolerates a missing key or a different type. An old report has
 * to keep printing.
 */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((entry) => record(entry)) : [];
}

/** Tags are loose strings, not rows: `list` would turn them into `{}`. */
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
 * Name lookup over the snapshot `actors` map. Returns an empty string when
 * there is no name, so the caller decides whether to fall back to the id or
 * omit the datum.
 */
function actorLookup(value: unknown): (id: unknown) => string {
  const actors = record(value);
  return (id: unknown) => {
    const key = str(id);
    const name = actors[key];
    return typeof name === 'string' ? name : '';
  };
}

/** Human-readable size of the evidence file. */
function size(value: unknown): string {
  const bytes = typeof value === 'number' ? value : Number(str(value));
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The RFC 3161 seal, if there is one. Saying so explicitly when there is NOT
 * one matters: evidence without a seal is worth less to a third party, and
 * staying silent in the report would suggest the opposite.
 */
function seal(value: unknown): string {
  const timestamp = record(value);
  const authority = str(timestamp.authority);
  return authority.length === 0
    ? 'sin sello de tiempo'
    : `sellada por ${authority} el ${date(timestamp.timestampedAt)}`;
}

/** Translates a domain enum; without a translation, returns the raw value. */
function label(value: unknown): string {
  const raw = str(value);
  // The snapshot is historical: it may carry a value that no longer exists in
  // today's enum. It is printed raw rather than being lost.
  return (LABELS as Record<string, string>)[raw] ?? raw;
}
