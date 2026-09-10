import type { Instant } from '../../../shared/time/Instant.js';
import { toDate } from '../../../shared/time/Instant.js';
import type { OrganizationRepository } from '../../identity-access/domain/ports/OrganizationRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { FraudDepartmentDailyTalliesReader } from '../domain/ports/FraudDepartmentDailyTalliesReader.js';
import type { FraudDepartmentMetricsRepository } from '../domain/ports/FraudDepartmentMetricsRepository.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { computeDailyMetrics } from '../domain/model/aggregates/computeDailyMetrics.js';
import { FraudDepartmentMetrics } from '../domain/model/aggregates/FraudDepartmentMetrics.js';
import { bogotaDayUtcRange } from '../../../shared/time/bogotaDay.js';

/**
 * Threshold used when an organization has no `organization_fraud_config` row
 * (design #645/LOCKED #642): no case's `risk_score` can ever be `>=
 * Infinity`, so `modelPositiveFraud`/`modelPositiveFalsePositive` stay 0 and
 * `computeDailyMetrics` yields `precisionModelo: null`, matching the "skip
 * precision, log it" rule without special-casing the tallies reader.
 */
const NO_CONFIG_RISK_THRESHOLD = Number.POSITIVE_INFINITY;

const LIST_PAGE_SIZE = 100;

export interface AggregateDailyFraudMetricsInput {
  readonly now?: Instant;
}

export interface AggregateDailyFraudMetricsSummary {
  readonly fecha: string;
  readonly organizationsProcessed: number;
  readonly failures: number;
}

export interface AggregateDailyFraudMetricsDeps {
  readonly organizations: OrganizationRepository;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly talliesReader: FraudDepartmentDailyTalliesReader;
  readonly metrics: FraudDepartmentMetricsRepository;
  readonly clock: Clock;
  readonly onError?: (error: unknown, ctx: { readonly organizationId: string }) => void;
}

/** Bogota calendar day (`YYYY-MM-DD`) that ended right before `instant`. */
function previousBogotaFecha(instant: Instant): string {
  const bogotaNow = new Date(toDate(instant).getTime() - 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(bogotaNow);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Nightly per-organization fraud metrics aggregation (design #645, MET-003).
 * Paginates ALL organizations via `OrganizationRepository.list`, computes
 * the previous full `America/Bogota` calendar day, and upserts one
 * `FraudDepartmentMetrics` row per org. Best-effort: a single org's failure
 * is caught, reported via `onError`, and does not abort the run — the
 * summary counts it.
 */
export function createAggregateDailyFraudMetricsUseCase(deps: AggregateDailyFraudMetricsDeps) {
  const onError = deps.onError ?? ((error: unknown, ctx: { organizationId: string }) => {
    console.error('[aggregate-daily-fraud-metrics] error:', ctx.organizationId, error);
  });

  return async function aggregateDailyFraudMetrics(
    input: AggregateDailyFraudMetricsInput = {},
  ): Promise<AggregateDailyFraudMetricsSummary> {
    const now = input.now ?? deps.clock.now();
    const fecha = previousBogotaFecha(now);
    const { dayStartUtc, dayEndUtc } = bogotaDayUtcRange(fecha);

    let organizationsProcessed = 0;
    let failures = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = await deps.organizations.list(LIST_PAGE_SIZE, cursor);

      for (const organization of page.items) {
        const organizationId = organization.id as unknown as string;
        try {
          await aggregateForOrganization({
            deps,
            organizationId,
            fecha,
            dayStartUtc,
            dayEndUtc,
            now,
          });
          organizationsProcessed += 1;
        } catch (error) {
          failures += 1;
          onError(error, { organizationId });
        }
      }

      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    return { fecha, organizationsProcessed, failures };
  };
}

async function aggregateForOrganization(args: {
  readonly deps: AggregateDailyFraudMetricsDeps;
  readonly organizationId: string;
  readonly fecha: string;
  readonly dayStartUtc: Date;
  readonly dayEndUtc: Date;
  readonly now: Instant;
}): Promise<void> {
  const { deps, organizationId, fecha, dayStartUtc, dayEndUtc, now } = args;

  const config = await deps.fraudConfig.findByOrganization(organizationId);
  const riskThresholdHigh = config?.riskThresholdHigh ?? NO_CONFIG_RISK_THRESHOLD;

  const tallies = await deps.talliesReader.dailyTallies({
    organizationId,
    dayStartUtc,
    dayEndUtc,
    riskThresholdHigh,
  });

  const computed = computeDailyMetrics(tallies);

  const metrics = FraudDepartmentMetrics.create({
    organizationId,
    fecha,
    casosAbiertos: computed.casosAbiertos,
    casosCerrados: computed.casosCerrados,
    slaCompliancePct: computed.slaCompliancePct,
    precisionModelo: computed.precisionModelo,
    falsePositiveRate: computed.falsePositiveRate,
    now,
  });

  await deps.metrics.upsert(metrics);
}
