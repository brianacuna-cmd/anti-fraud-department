import type { RegulatoryReport } from '../../../../domain/model/aggregates/RegulatoryReport.js';

export interface ReportRow {
  readonly concept: string;
  readonly value: string;
}

/** Cuánto vale una cifra ausente, dicho igual en los dos formatos. */
const NO_DISPONIBLE = 'No disponible';

function count(n: number): string {
  return new Intl.NumberFormat('es').format(n);
}

/**
 * Las filas del reporte, en el orden en que se leen.
 *
 * Compartidas entre el PDF y el Excel a propósito: son el mismo documento en
 * dos envases, y dos listas separadas divergirían a la primera cifra nueva —
 * dejando al inquilino con un PDF y un Excel del mismo periodo que no cuadran.
 */
export function reportRows(report: RegulatoryReport): readonly ReportRow[] {
  const f = report.figures;
  return [
    { concept: 'Expedientes abiertos', value: count(f.casesOpened) },
    { concept: 'Expedientes cerrados', value: count(f.casesResolved) },
    { concept: 'Fraude confirmado', value: count(f.fraudConfirmed) },
    { concept: 'Falsos positivos', value: count(f.falsePositives) },
    { concept: 'Expedientes fuera de plazo', value: count(f.slaBreached) },
    { concept: 'Medidas cautelares ejecutadas', value: count(f.enforcementExecuted) },
    { concept: 'Medidas cautelares revertidas', value: count(f.enforcementReverted) },
    { concept: 'Reportes de operación sospechosa radicados', value: count(f.sarsFiled) },
    {
      concept: 'Monto sospechoso declarado en SAR',
      value:
        f.suspiciousAmountDeclared === null
          ? NO_DISPONIBLE
          : new Intl.NumberFormat('es', { minimumFractionDigits: 2 }).format(
              f.suspiciousAmountDeclared,
            ),
    },
    {
      /*
       * Se imprime aunque no haya dato.
       *
       * Omitir la fila dejaría al que lee sin saber que la cifra existe y falta;
       * un 0 afirmaría que no se bloqueó nada. «No disponible» es lo único de
       * los tres que es cierto — y obliga a explicarlo si un supervisor
       * pregunta, que es exactamente lo que debe pasar.
       */
      concept: 'Montos bloqueados',
      value: NO_DISPONIBLE,
    },
  ];
}

/** Cabecera común: de qué periodo habla y si es definitivo. */
export function reportHeading(report: RegulatoryReport): {
  readonly title: string;
  readonly period: string;
  readonly state: string;
} {
  return {
    title: 'Reporte regulatorio periódico',
    period: `Periodo: ${report.periodStart.slice(0, 10)} a ${report.periodEnd.slice(0, 10)}`,
    state:
      report.status === 'ISSUED'
        ? `Emitido el ${(report.issuedAt ?? '').slice(0, 10)}`
        : 'BORRADOR — cifras sujetas a cambio, no apto para presentación',
  };
}
