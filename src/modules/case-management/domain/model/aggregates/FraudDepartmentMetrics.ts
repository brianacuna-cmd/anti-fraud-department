import type { Instant } from '../../../../../shared/time/Instant.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

const FECHA_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface FraudDepartmentMetricsProps {
  readonly organizationId: string;
  /** Bogota calendar day the row belongs to, 'YYYY-MM-DD' (design: fecha). */
  readonly fecha: string;
  readonly casosAbiertos: number;
  readonly casosCerrados: number;
  /** Percentage in [0, 100], 2 decimal places; null when no closures that day. */
  readonly slaCompliancePct: number | null;
  /** Ratio in [0, 1], 4 decimal places; null when TP+FP=0 that day. */
  readonly precisionModelo: number | null;
  /** Ratio in [0, 1], 4 decimal places; null when no analyst_decisions that day. */
  readonly falsePositiveRate: number | null;
  readonly createdAt: Instant;
}

export interface CreateFraudDepartmentMetricsInput {
  readonly organizationId: string;
  readonly fecha: string;
  readonly casosAbiertos: number;
  readonly casosCerrados: number;
  readonly slaCompliancePct: number | null;
  readonly precisionModelo: number | null;
  readonly falsePositiveRate: number | null;
  readonly now: Instant;
}

/**
 * Nightly per-organization, per-Bogota-day fraud metrics row (design:
 * fraud_department_metrics, MET-003). No id value object: the natural key
 * is `(organizationId, fecha)`, enforced idempotent by the repository/unique
 * index — this aggregate carries no surrogate identity of its own.
 */
export class FraudDepartmentMetrics {
  private constructor(private readonly props: FraudDepartmentMetricsProps) {}

  static create(input: CreateFraudDepartmentMetricsInput): FraudDepartmentMetrics {
    assertNonEmpty('organizationId', input.organizationId);
    assertFecha(input.fecha);
    assertNonNegativeInteger('casosAbiertos', input.casosAbiertos);
    assertNonNegativeInteger('casosCerrados', input.casosCerrados);
    assertRatioOrNull('slaCompliancePct', input.slaCompliancePct, 0, 100);
    assertRatioOrNull('precisionModelo', input.precisionModelo, 0, 1);
    assertRatioOrNull('falsePositiveRate', input.falsePositiveRate, 0, 1);

    return new FraudDepartmentMetrics({
      organizationId: input.organizationId,
      fecha: input.fecha,
      casosAbiertos: input.casosAbiertos,
      casosCerrados: input.casosCerrados,
      slaCompliancePct: input.slaCompliancePct,
      precisionModelo: input.precisionModelo,
      falsePositiveRate: input.falsePositiveRate,
      createdAt: input.now,
    });
  }

  static rehydrate(props: FraudDepartmentMetricsProps): FraudDepartmentMetrics {
    return new FraudDepartmentMetrics(props);
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get fecha(): string {
    return this.props.fecha;
  }

  get casosAbiertos(): number {
    return this.props.casosAbiertos;
  }

  get casosCerrados(): number {
    return this.props.casosCerrados;
  }

  get slaCompliancePct(): number | null {
    return this.props.slaCompliancePct;
  }

  get precisionModelo(): number | null {
    return this.props.precisionModelo;
  }

  get falsePositiveRate(): number | null {
    return this.props.falsePositiveRate;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): FraudDepartmentMetricsProps {
    return this.props;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`FraudDepartmentMetrics ${field} must be a non-empty string`, {
      field,
      value,
    });
  }
}

function assertFecha(fecha: string): void {
  if (!FECHA_PATTERN.test(fecha) || !isValidCalendarDay(fecha)) {
    throw invariantViolation('FraudDepartmentMetrics fecha must be a valid "YYYY-MM-DD" calendar day', {
      fecha,
    });
  }
}

function isValidCalendarDay(fecha: string): boolean {
  const [year, month, day] = fecha.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function assertNonNegativeInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw invariantViolation(`FraudDepartmentMetrics ${field} must be a non-negative integer`, {
      field,
      value,
    });
  }
}

function assertRatioOrNull(field: string, value: number | null, min: number, max: number): void {
  if (value === null) {
    return;
  }
  if (Number.isNaN(value) || value < min || value > max) {
    throw invariantViolation(`FraudDepartmentMetrics ${field} must be null or within [${min}, ${max}]`, {
      field,
      value,
      min,
      max,
    });
  }
}
