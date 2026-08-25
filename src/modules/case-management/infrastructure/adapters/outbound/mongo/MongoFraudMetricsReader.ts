import { ObjectId, type Collection, type Db, type Document, type Filter } from 'mongodb';
import type {
  AssigneeWorkload,
  DailyCaseFlowPoint,
  FraudMetricsQuery,
  FraudMetricsReader,
  FraudMetricsSnapshot,
  RiskBucket,
} from '../../../../domain/ports/FraudMetricsReader.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import type { EnforcementActionDocument } from './documents/EnforcementActionDocument.js';
import type { ResolutionDocument } from './documents/ResolutionDocument.js';
import { toDate } from '../../../../../../shared/time/Instant.js';

const CASES = 'cases';
const ENFORCEMENT_ACTIONS = 'enforcement_actions';
const RESOLUTIONS = 'resolutions';

/** Estados en los que un expediente sigue sobre la mesa de alguien. */
const ACTIVE_STATUSES = ['OPEN', 'IN_REVIEW'];

/**
 * Cortes de riesgo del panel. Fijos y nombrados aqui —no configurables— para
 * que dos lecturas del panel en momentos distintos sean comparables.
 */
const RISK_BUCKETS: readonly { label: string; from: number; to: number }[] = [
  { label: 'Bajo', from: 0, to: 24 },
  { label: 'Medio', from: 25, to: 49 },
  { label: 'Alto', from: 50, to: 74 },
  { label: 'Crítico', from: 75, to: 100 },
];

/** Cuantos responsables devuelve `workload`: una barra por persona, no un censo. */
const WORKLOAD_LIMIT = 8;

interface CountRow {
  readonly _id: string | null;
  readonly count: number;
}

/**
 * Lado de lectura del panel de gobierno.
 *
 * Todo se resuelve con `aggregate` en el servidor y NUNCA trayendo los casos
 * al proceso: el panel lo abre quien supervisa el departamento entero, con lo
 * que la alternativa —listar y contar en Node— crece con el tamaño del
 * inquilino justo para quien mas casos tiene.
 */
export class MongoFraudMetricsReader implements FraudMetricsReader {
  private readonly cases: Collection<CaseDocument>;
  private readonly enforcementActions: Collection<EnforcementActionDocument>;
  private readonly resolutions: Collection<ResolutionDocument>;

  constructor(db: Db) {
    this.cases = db.collection<CaseDocument>(CASES);
    this.enforcementActions = db.collection<EnforcementActionDocument>(ENFORCEMENT_ACTIONS);
    this.resolutions = db.collection<ResolutionDocument>(RESOLUTIONS);
  }

  async snapshot(query: FraudMetricsQuery): Promise<FraudMetricsSnapshot> {
    const organizationId = new ObjectId(query.organizationId);
    const now = toDate(query.now);
    const windowStart = startOfUtcDay(addDays(now, -(query.windowDays - 1)));
    // `deleted_at: null` en TODA consulta: un expediente retirado no debe
    // seguir sumando en ninguna barra del panel.
    const tenant = { organization_id: organizationId, deleted_at: null };

    const [byStatus, byPriority, byRiskBucket, overdue, unassigned, opened, enforcementByStatus, enforcementByType, workload, closures] =
      await Promise.all([
        this.countBy(this.cases, tenant, '$status'),
        this.countBy(this.cases, tenant, '$priority'),
        this.riskBuckets(tenant),
        this.cases.countDocuments({
          ...tenant,
          status: { $in: ACTIVE_STATUSES },
          due_date: { $ne: null, $lt: now },
        }),
        this.cases.countDocuments({ ...tenant, status: { $in: ACTIVE_STATUSES }, assigned_to: null }),
        this.openedPerDay({ ...tenant, created_at: { $gte: windowStart } }),
        this.countBy(this.enforcementActions, { organization_id: organizationId }, '$status'),
        this.countBy(this.enforcementActions, { organization_id: organizationId }, '$action_type'),
        this.workload(tenant, now),
        this.closures(organizationId, windowStart),
      ]);

    const totals = Object.values(byStatus).reduce((sum, value) => sum + value, 0);

    return {
      generatedAt: query.now,
      windowDays: query.windowDays,
      cases: {
        total: totals,
        byStatus,
        byPriority,
        byRiskBucket,
        overdue,
        unassigned,
      },
      flow: buildFlowSeries(windowStart, query.windowDays, opened, closures.daily),
      enforcement: {
        byStatus: enforcementByStatus,
        byActionType: enforcementByType,
        pendingApproval: enforcementByStatus.PENDING ?? 0,
      },
      workload,
      resolution: closures.resolution,
    };
  }

  /**
   * `$group` por un campo, generico sobre la coleccion: `cases` y
   * `enforcement_actions` cuentan igual y solo cambian de origen y de filtro.
   */
  private async countBy<T extends Document>(
    collection: Collection<T>,
    match: Filter<T>,
    field: string,
  ): Promise<Record<string, number>> {
    const rows = await collection
      .aggregate<CountRow>([{ $match: match }, { $group: { _id: field, count: { $sum: 1 } } }])
      .toArray();
    return Object.fromEntries(
      rows.filter((row) => row._id !== null).map((row) => [row._id as string, row.count]),
    );
  }

  private async riskBuckets(match: Record<string, unknown>): Promise<readonly RiskBucket[]> {
    const rows = await this.cases
      .aggregate<{ _id: number; count: number }>([
        { $match: match },
        {
          $bucket: {
            groupBy: '$risk_score',
            boundaries: [...RISK_BUCKETS.map((bucket) => bucket.from), 101],
            // Un `risk_score` fuera de 0..100 seria un dato corrupto; que caiga
            // en un cajon propio y no contamine el tramo "Crítico".
            default: -1,
            output: { count: { $sum: 1 } },
          },
        },
      ])
      .toArray();

    const counts = new Map(rows.map((row) => [row._id, row.count]));
    return RISK_BUCKETS.map((bucket) => ({ ...bucket, count: counts.get(bucket.from) ?? 0 }));
  }

  /** Altas por dia natural UTC. Los cierres salen de `closures`, con su join. */
  private async openedPerDay(match: Filter<CaseDocument>): Promise<Map<string, number>> {
    const rows = await this.cases
      .aggregate<CountRow>([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();
    return new Map(
      rows.filter((row) => row._id !== null).map((row) => [row._id as string, row.count]),
    );
  }

  private async workload(
    match: Record<string, unknown>,
    now: Date,
  ): Promise<readonly AssigneeWorkload[]> {
    const rows = await this.cases
      .aggregate<{
        _id: { assignee: string; type: string | null };
        open: number;
        overdue: number;
      }>([
        { $match: { ...match, status: { $in: ACTIVE_STATUSES }, assigned_to: { $ne: null } } },
        {
          $group: {
            _id: { assignee: '$assigned_to', type: '$assigned_to_type' },
            open: { $sum: 1 },
            overdue: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$due_date', null] }, { $lt: ['$due_date', now] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { open: -1 } },
        { $limit: WORKLOAD_LIMIT },
      ])
      .toArray();

    return rows.map((row) => ({
      assigneeId: row._id.assignee,
      assigneeType: row._id.type ?? 'USER',
      open: row.open,
      overdue: row.overdue,
    }));
  }

  /**
   * Cierres de la ventana: la serie diaria y cuanto se tardo de media.
   *
   * Las dos salen de la MISMA agregacion (`$facet`) porque comparten filtro, y
   * ese filtro es la razon de que no baste con contar `resolutions`:
   *
   * - El tiempo se mide contra `cases.created_at`, y `resolutions` guarda
   *   cuando se cerro pero no cuando se abrio — de ahi el `$lookup`.
   * - Un expediente retirado (`deleted_at`) no cuenta en ninguna otra barra
   *   del panel. Contando `resolutions` a secas, su cierre SI aparecia en la
   *   linea: el panel se contradecia consigo mismo, con un dia que registraba
   *   mas cierres que altas sin que hubiera pasado nada raro.
   */
  private async closures(
    organizationId: ObjectId,
    windowStart: Date,
  ): Promise<{
    daily: Map<string, number>;
    resolution: { resolvedInWindow: number; averageHoursToResolve: number | null };
  }> {
    const [row] = await this.resolutions
      .aggregate<{
        daily: CountRow[];
        totals: { resolvedInWindow: number; averageMs: number | null }[];
      }>([
        { $match: { organization_id: organizationId, created_at: { $gte: windowStart } } },
        { $lookup: { from: CASES, localField: 'case_id', foreignField: '_id', as: 'kase' } },
        { $unwind: '$kase' },
        { $match: { 'kase.deleted_at': null } },
        {
          $facet: {
            daily: [
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' },
                  },
                  count: { $sum: 1 },
                },
              },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  resolvedInWindow: { $sum: 1 },
                  averageMs: { $avg: { $subtract: ['$created_at', '$kase.created_at'] } },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const daily = new Map(
      (row?.daily ?? [])
        .filter((entry) => entry._id !== null)
        .map((entry) => [entry._id as string, entry.count]),
    );
    const totals = row?.totals[0];

    return {
      daily,
      resolution: {
        resolvedInWindow: totals?.resolvedInWindow ?? 0,
        averageHoursToResolve:
          totals?.averageMs == null ? null : Math.round((totals.averageMs / 3_600_000) * 10) / 10,
      },
    };
  }
}

/**
 * Rellena los dias sin movimiento con ceros. Mongo solo devuelve los dias que
 * existen; una serie con huecos dibuja una linea que se salta fechas.
 */
function buildFlowSeries(
  windowStart: Date,
  windowDays: number,
  opened: Map<string, number>,
  resolved: Map<string, number>,
): readonly DailyCaseFlowPoint[] {
  const points: DailyCaseFlowPoint[] = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = addDays(windowStart, offset).toISOString().slice(0, 10);
    points.push({ date, opened: opened.get(date) ?? 0, resolved: resolved.get(date) ?? 0 });
  }
  return points;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
