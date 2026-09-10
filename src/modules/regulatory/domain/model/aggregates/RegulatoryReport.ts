import type { Instant } from '../../../../../shared/time/Instant.js';
import { toDate } from '../../../../../shared/time/Instant.js';
import type { RegulatoryReportId } from '../value-objects/RegulatoryReportId.js';
import type { RegulatoryReportStatus } from '../value-objects/RegulatoryReportStatus.js';
import type { RegulatoryFigures } from '../value-objects/RegulatoryFigures.js';
import {
  invalidReportingPeriod,
  invariantViolation,
  reportAlreadyIssued,
} from '../../errors/RegulatoryError.js';

export interface RegulatoryReportProps {
  readonly id: RegulatoryReportId;
  readonly organizationId: string;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
  readonly status: RegulatoryReportStatus;
  /**
   * Las cifras, CONGELADAS.
   *
   * Es la decisión que define este agregado. El panel de gobierno recalcula en
   * vivo y debe hacerlo; un reporte regulatorio no puede. El documento que se
   * entregó a una Superintendencia tiene que poder reproducirse dentro de tres
   * años con los mismos números, y para entonces los expedientes se habrán
   * reabierto, reasignado y anonimizado. Guardar la consulta en vez del
   * resultado haría que el reporte cambiara solo.
   */
  readonly figures: RegulatoryFigures;
  readonly generatedBy: string;
  readonly generatedAt: Instant;
  readonly issuedBy: string | null;
  readonly issuedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateRegulatoryReportInput {
  readonly id: RegulatoryReportId;
  readonly organizationId: string;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
  readonly figures: RegulatoryFigures;
  readonly generatedBy: string;
  readonly now: Instant;
}

/**
 * Un reporte periódico para entes de control (REG-001 / REG-002).
 */
export class RegulatoryReport {
  private constructor(private readonly props: RegulatoryReportProps) {}

  static create(input: CreateRegulatoryReportInput): RegulatoryReport {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('generatedBy', input.generatedBy);
    assertPeriod(input.periodStart, input.periodEnd, input.now);

    return new RegulatoryReport({
      id: input.id,
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'DRAFT',
      figures: input.figures,
      generatedBy: input.generatedBy,
      generatedAt: input.now,
      issuedBy: null,
      issuedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstruye desde persistencia — sin validar reglas de negocio. */
  static rehydrate(props: RegulatoryReportProps): RegulatoryReport {
    return new RegulatoryReport(props);
  }

  /**
   * Vuelve a calcular las cifras del mismo periodo.
   *
   * Se permite mientras sea borrador porque los datos del periodo siguen
   * moviéndose: un caso abierto el día 30 se cierra el 2 del mes siguiente, y
   * el reporte compilado el día 1 se quedó corto. Sobre un reporte YA EMITIDO
   * es imposible, y no por rigidez: fuera de este sistema hay una copia con un
   * número de radicación que alguien citó.
   */
  recompile(figures: RegulatoryFigures, now: Instant): RegulatoryReport {
    this.assertNotIssued();
    return new RegulatoryReport({ ...this.props, figures, generatedAt: now, updatedAt: now });
  }

  /** El paso irreversible: el borrador pasa a ser el documento oficial. */
  issue(issuedBy: string, now: Instant): RegulatoryReport {
    this.assertNotIssued();
    assertNonEmpty('issuedBy', issuedBy);
    return new RegulatoryReport({
      ...this.props,
      status: 'ISSUED',
      issuedBy,
      issuedAt: now,
      updatedAt: now,
    });
  }

  private assertNotIssued(): void {
    if (this.props.status === 'ISSUED') {
      throw reportAlreadyIssued(this.props.id, this.props.issuedAt ?? '');
    }
  }

  get id(): RegulatoryReportId {
    return this.props.id;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get periodStart(): Instant {
    return this.props.periodStart;
  }
  get periodEnd(): Instant {
    return this.props.periodEnd;
  }
  get status(): RegulatoryReportStatus {
    return this.props.status;
  }
  get figures(): RegulatoryFigures {
    return this.props.figures;
  }
  get generatedBy(): string {
    return this.props.generatedBy;
  }
  get generatedAt(): Instant {
    return this.props.generatedAt;
  }
  get issuedBy(): string | null {
    return this.props.issuedBy;
  }
  get issuedAt(): Instant | null {
    return this.props.issuedAt;
  }
  get createdAt(): Instant {
    return this.props.createdAt;
  }
  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  /** Props completas, solo para el mapper de persistencia. */
  toProps(): RegulatoryReportProps {
    return this.props;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`RegulatoryReport ${field} must be a non-empty string`, { field });
  }
}

function assertPeriod(from: Instant, to: Instant, now: Instant): void {
  const fromMs = toDate(from).getTime();
  const toMs = toDate(to).getTime();

  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw invalidReportingPeriod('the reporting period is not a valid pair of dates', from, to);
  }
  if (fromMs >= toMs) {
    throw invalidReportingPeriod('the reporting period must start before it ends', from, to);
  }
  /*
   * Un periodo que llega al futuro no es un error de tipeo cualquiera: produce
   * un reporte que dice "en octubre pasó esto" cuando octubre no ha terminado,
   * y esa cifra parcial se presenta como definitiva. Se rechaza en el
   * agregado y no en el esquema HTTP porque es una regla del documento, no del
   * transporte.
   */
  if (toMs > toDate(now).getTime()) {
    throw invalidReportingPeriod('the reporting period cannot end in the future', from, to);
  }
}
