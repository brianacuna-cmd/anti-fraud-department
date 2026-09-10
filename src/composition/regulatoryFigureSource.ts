import { ObjectId, type Db } from 'mongodb';
import type {
  FigureQuery,
  RegulatoryFigureSource,
} from '../modules/regulatory/domain/ports/RegulatoryFigureSource.js';
import type { RegulatoryFigures } from '../modules/regulatory/domain/model/value-objects/RegulatoryFigures.js';

/**
 * Implementación en la raíz de composición del puerto `RegulatoryFigureSource`
 * — mismo patrón que `subjectDataSource.ts` o `sarSourceVerifier.ts`: el puerto
 * estrecho vive en el dominio del módulo nuevo y ESTE fichero, la única costura
 * legal para un import entre módulos, lo conecta al almacenamiento real.
 *
 * SE CUENTAN EVENTOS, NO ESTADOS ACTUALES
 *
 * La tentación es contar filas cuyo estado de HOY coincide: medidas con estado
 * `EXECUTED` y `updated_at` dentro del periodo. Es incorrecto de dos maneras a
 * la vez. Una medida ejecutada en septiembre y revertida en octubre dejaría de
 * contarse en el reporte de septiembre, que es justo el mes en que se ejecutó;
 * y `updated_at` cambia con cualquier modificación, así que ni siquiera marca
 * el momento del cambio de estado.
 *
 * Por eso las cifras salen de donde el evento quedó fechado: `audit_logs` para
 * las medidas, `analyst_decisions` y `resolutions` para los dictámenes. Un
 * reporte regulatorio afirma qué OCURRIÓ en un periodo, no cómo están las cosas
 * ahora.
 */
export function createRegulatoryFigureSource(db: Db): RegulatoryFigureSource {
  return {
    async compute(query: FigureQuery): Promise<RegulatoryFigures> {
      const org = new ObjectId(query.organizationId);
      const from = new Date(query.periodStart);
      const to = new Date(query.periodEnd);
      const between = { $gte: from, $lte: to };

      const [
        casesOpened,
        casesResolved,
        fraudConfirmed,
        falsePositives,
        slaBreached,
        enforcementExecuted,
        enforcementReverted,
        sarAggregate,
      ] = await Promise.all([
        db.collection('cases').countDocuments({ organization_id: org, created_at: between }),

        // La fila de `resolutions` nace al cerrar el expediente: su `created_at`
        // ES el cierre, sin depender de en qué estado quedó el caso después.
        db.collection('resolutions').countDocuments({ organization_id: org, created_at: between }),

        db.collection('analyst_decisions').countDocuments({
          organization_id: org,
          decision: 'FRAUD_CONFIRMED',
          created_at: between,
        }),
        db.collection('analyst_decisions').countDocuments({
          organization_id: org,
          decision: 'FALSE_POSITIVE',
          created_at: between,
        }),

        /*
         * `case_sla_tracking` NO lleva `organization_id`: hay que pasar por el
         * expediente para saber de quién es. El `$lookup` es el precio de esa
         * ausencia; filtrar antes por estado y fecha deja el join sobre un
         * conjunto pequeño.
         */
        db
          .collection('case_sla_tracking')
          .aggregate([
            { $match: { status: 'BREACHED', updated_at: between } },
            {
              $lookup: {
                from: 'cases',
                localField: 'case_id',
                foreignField: '_id',
                as: 'kase',
                pipeline: [{ $match: { organization_id: org } }, { $project: { _id: 1 } }],
              },
            },
            { $match: { 'kase.0': { $exists: true } } },
            { $count: 'total' },
          ])
          .toArray()
          .then((rows) => (rows[0]?.total as number | undefined) ?? 0),

        db.collection('audit_logs').countDocuments({
          organization_id: org,
          action: 'EXECUTE_ENFORCEMENT_ACTION',
          created_at: between,
        }),
        db.collection('audit_logs').countDocuments({
          organization_id: org,
          action: 'REVERT_ENFORCEMENT_ACTION',
          created_at: between,
        }),

        /*
         * Radicados, no redactados: `filed_at` marca la presentación ante el
         * regulador. Un SAR aprobado pero sin radicar todavía no es una
         * declaración, y contarlo inflaría la cifra que más mira un supervisor.
         */
        db
          .collection('sar_reports')
          .aggregate([
            { $match: { organization_id: org, filed_at: between } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                // `$sum` ignora los null, pero no distingue "ninguno declaró"
                // de "todos declararon cero": por eso se cuentan aparte los que
                // sí traen importe.
                amount: { $sum: '$suspicious_amount' },
                withAmount: {
                  $sum: { $cond: [{ $ifNull: ['$suspicious_amount', false] }, 1, 0] },
                },
              },
            },
          ])
          .toArray()
          .then((rows) => rows[0] as { count: number; amount: number; withAmount: number } | undefined),
      ]);

      return {
        casesOpened,
        casesResolved,
        fraudConfirmed,
        falsePositives,
        slaBreached,
        enforcementExecuted,
        enforcementReverted,
        sarsFiled: sarAggregate?.count ?? 0,
        suspiciousAmountDeclared:
          sarAggregate === undefined || sarAggregate.withAmount === 0 ? null : sarAggregate.amount,
        blockedAmount: null,
      };
    },
  };
}
