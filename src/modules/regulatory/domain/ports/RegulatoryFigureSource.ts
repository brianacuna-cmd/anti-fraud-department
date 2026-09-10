import type { Instant } from '../../../../shared/time/Instant.js';
import type { RegulatoryFigures } from '../model/value-objects/RegulatoryFigures.js';

export interface FigureQuery {
  readonly organizationId: string;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
}

/**
 * Puerto estrecho cross-module — mismo patrón que `SubjectDataSource` de
 * privacy o `SarSourceVerifier` de sar. El dominio de `regulatory` no importa
 * nunca el dominio de `case-management`, `screening` ni `sar`; la raíz de
 * composición implementa esto envolviendo el almacenamiento real.
 *
 * Devuelve las cifras YA agregadas. Que no devuelva filas es deliberado: un
 * reporte regulatorio son totales, y si este puerto entregara expedientes,
 * alguien acabaría derivando de ellos una cifra distinta de la que se
 * congeló.
 */
export interface RegulatoryFigureSource {
  compute(query: FigureQuery): Promise<RegulatoryFigures>;
}
