/**
 * The figures a supervisor asks for, frozen at compilation time.
 *
 * Every field is either a count this system can prove or an amount it can
 * source. Nothing here is estimated, and that constraint decided the shape:
 * see `blockedAmount`.
 */
export interface RegulatoryFigures {
  /** Expedientes abiertos en el periodo. */
  readonly casesOpened: number;
  /** Expedientes cerrados en el periodo, sea cual sea su veredicto. */
  readonly casesResolved: number;
  /** De los cerrados, cuántos con dictamen de fraude confirmado. */
  readonly fraudConfirmed: number;
  /** De los cerrados, cuántos descartados como falso positivo. */
  readonly falsePositives: number;
  /** Expedientes que superaron su plazo dentro del periodo. */
  readonly slaBreached: number;

  /** Medidas cautelares efectivamente aplicadas. */
  readonly enforcementExecuted: number;
  /** De esas, cuántas se revirtieron después. */
  readonly enforcementReverted: number;

  /** Reportes de operación sospechosa radicados ante el regulador. */
  readonly sarsFiled: number;

  /**
   * Suma de los importes declarados en los SAR radicados en el periodo.
   *
   * Sale de `sar_reports.suspicious_amount` y no de los expedientes, porque es
   * el ÚNICO importe que este sistema tiene estructurado — y además es el
   * correcto: un SAR es la declaración formal de una operación sospechosa, con
   * la cifra que el oficial de cumplimiento afirmó ante el regulador.
   *
   * `null` cuando ningún SAR del periodo declaró importe. Un 0 diría que hubo
   * actividad sospechosa por valor de cero, que es una afirmación distinta.
   *
   * SIN MONEDA: `sar_reports` no guarda divisa. La suma vale mientras el
   * inquilino radique en una sola, que es el caso hoy. El día que radique en
   * dos, esta cifra deja de significar nada y hay que añadir la divisa antes
   * que sumar.
   */
  readonly suspiciousAmountDeclared: number | null;

  /**
   * Montos bloqueados: NO DISPONIBLE, y a propósito.
   *
   * El requisito lo pide, pero `enforcement_actions` no guarda ningún importe:
   * una medida dice a quién y de qué tipo, nunca sobre cuánto dinero. Se podría
   * inferir del snapshot del proveedor, que es texto libre de un tercero, y esa
   * inferencia acabaría impresa en un documento firmado ante una
   * Superintendencia.
   *
   * Va como `null` explícito y no omitido: un renglón que dice «no disponible»
   * enseña algo al que lee el reporte; una fila ausente no enseña nada, y un 0
   * afirmaría que no se bloqueó nada. Para llenarlo hay que añadir el importe
   * a la medida cautelar en origen.
   */
  readonly blockedAmount: null;
}

/** Figuras en cero, para un periodo sin actividad. */
export const EMPTY_FIGURES: RegulatoryFigures = {
  casesOpened: 0,
  casesResolved: 0,
  fraudConfirmed: 0,
  falsePositives: 0,
  slaBreached: 0,
  enforcementExecuted: 0,
  enforcementReverted: 0,
  sarsFiled: 0,
  suspiciousAmountDeclared: null,
  blockedAmount: null,
};
