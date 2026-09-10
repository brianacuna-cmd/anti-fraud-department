import { oid } from '../../../support/oid.js';
import { createAggregateDailyFraudMetricsUseCase } from '../../../../src/modules/case-management/application/AggregateDailyFraudMetrics.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryFraudDepartmentMetricsRepository } from '../../../helpers/case-management/InMemoryFraudDepartmentMetricsRepository.js';
import { FakeFraudDepartmentDailyTalliesReader } from '../../../helpers/case-management/FakeFraudDepartmentDailyTalliesReader.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const CREATED_AT = fromDate(new Date('2026-09-01T00:00:00.000Z'));
// Exactly Bogota midnight 2026-09-10T00:00:00-05:00 -> previous full Bogota
// day is 2026-09-09.
const NOW = fromDate(new Date('2026-09-10T05:00:00.000Z'));
const EXPECTED_FECHA = '2026-09-09';

function buildOrganization(id: string, name: string, slugLabel: string): Organization {
  return Organization.create({
    id: createOrganizationId(id),
    name,
    slug: createSlug(slugLabel),
    now: CREATED_AT,
  });
}

function buildDeps(overrides: { onError?: (error: unknown, ctx: { organizationId: string }) => void } = {}) {
  const organizations = new InMemoryOrganizationRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const metrics = new InMemoryFraudDepartmentMetricsRepository();
  const talliesReader = new FakeFraudDepartmentDailyTalliesReader();
  const clock = new FixedClock(NOW);

  const useCase = createAggregateDailyFraudMetricsUseCase({
    organizations,
    fraudConfig,
    talliesReader,
    metrics,
    clock,
    ...(overrides.onError ? { onError: overrides.onError } : {}),
  });

  return { organizations, fraudConfig, metrics, talliesReader, clock, useCase };
}

describe('AggregateDailyFraudMetrics', () => {
  it('iterates multiple organizations (paginated) and upserts one row per org for the previous Bogota day', async () => {
    const { organizations, metrics, useCase } = buildDeps();
    const orgA = oid('org-a');
    const orgB = oid('org-b');
    const orgC = oid('org-c');
    await organizations.save(buildOrganization(orgA, 'Org A', 'org-a-slug-1'));
    await organizations.save(buildOrganization(orgB, 'Org B', 'org-b-slug-1'));
    await organizations.save(buildOrganization(orgC, 'Org C', 'org-c-slug-1'));

    const summary = await useCase({});

    expect(summary).toEqual({ fecha: EXPECTED_FECHA, organizationsProcessed: 3, failures: 0 });
    expect(metrics.size()).toBe(3);
    for (const orgId of [orgA, orgB, orgC]) {
      const row = await metrics.findByOrgAndDate(orgId, EXPECTED_FECHA);
      expect(row).not.toBeNull();
      expect(row?.fecha).toBe(EXPECTED_FECHA);
    }
  });

  it('resolves riskThresholdHigh per org from config; an org without config gets a null precision', async () => {
    const { organizations, fraudConfig, metrics, talliesReader, useCase } = buildDeps();
    const orgWithConfig = oid('org-with-config');
    const orgWithoutConfig = oid('org-without-config');
    await organizations.save(buildOrganization(orgWithConfig, 'Org With Config', 'org-with-config-slug'));
    await organizations.save(buildOrganization(orgWithoutConfig, 'Org Without Config', 'org-without-config-slug'));

    fraudConfig.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId(oid('config-1')),
        organizationId: orgWithConfig,
        slaLowMinutes: 240,
        slaMediumMinutes: 120,
        slaHighMinutes: 60,
        slaCriticalMinutes: 30,
        riskThresholdLow: 25,
        riskThresholdMedium: 50,
        riskThresholdHigh: 70,
        riskThresholdCritical: 90,
        now: CREATED_AT,
      }),
    );

    talliesReader.seed(orgWithConfig, {
      decisionsTotal: 3,
      falsePositive: 1,
      modelPositiveFraud: 2,
      modelPositiveFalsePositive: 1,
    });
    // The fake reader (unlike the real Mongo aggregation) does not itself
    // apply riskThresholdHigh filtering — it is a pure fixture. Leaving
    // modelPositive* at zero here stands in for what the real reader would
    // produce with riskThresholdHigh=Infinity (no case ever qualifies), so
    // this still exercises the "no config -> null precision" path end to end.
    talliesReader.seed(orgWithoutConfig, {
      decisionsTotal: 3,
      falsePositive: 1,
    });

    await useCase({});

    const withConfigCall = talliesReader.calls.find((c) => c.organizationId === orgWithConfig);
    const withoutConfigCall = talliesReader.calls.find((c) => c.organizationId === orgWithoutConfig);
    expect(withConfigCall?.riskThresholdHigh).toBe(70);
    expect(withoutConfigCall?.riskThresholdHigh).toBe(Number.POSITIVE_INFINITY);

    const withConfigRow = await metrics.findByOrgAndDate(orgWithConfig, EXPECTED_FECHA);
    const withoutConfigRow = await metrics.findByOrgAndDate(orgWithoutConfig, EXPECTED_FECHA);
    expect(withConfigRow?.precisionModelo).toBeCloseTo(2 / 3, 4);
    expect(withoutConfigRow?.precisionModelo).toBeNull();
  });

  it('is best-effort: a failing org is logged via onError and does not stop the others', async () => {
    const errors: Array<{ organizationId: string }> = [];
    const { organizations, metrics, talliesReader, useCase } = buildDeps({
      onError: (_error, ctx) => errors.push(ctx),
    });
    const goodOrg = oid('org-good');
    const badOrg = oid('org-bad');
    await organizations.save(buildOrganization(goodOrg, 'Good Org', 'good-org-slug'));
    await organizations.save(buildOrganization(badOrg, 'Bad Org', 'bad-org-slug'));
    talliesReader.failFor(badOrg);

    const summary = await useCase({});

    expect(summary).toEqual({ fecha: EXPECTED_FECHA, organizationsProcessed: 1, failures: 1 });
    expect(errors).toEqual([{ organizationId: badOrg }]);
    expect(await metrics.findByOrgAndDate(goodOrg, EXPECTED_FECHA)).not.toBeNull();
    expect(await metrics.findByOrgAndDate(badOrg, EXPECTED_FECHA)).toBeNull();
  });

  it('is idempotent: running twice upserts, one row per org+fecha', async () => {
    const { organizations, metrics, useCase } = buildDeps();
    const orgA = oid('org-idempotent');
    await organizations.save(buildOrganization(orgA, 'Org Idempotent', 'org-idempotent-slug'));

    await useCase({});
    await useCase({});

    expect(metrics.size()).toBe(1);
    expect(await metrics.findByOrgAndDate(orgA, EXPECTED_FECHA)).not.toBeNull();
  });

  it('returns a zero summary when there are no organizations', async () => {
    const { metrics, useCase } = buildDeps();

    const summary = await useCase({});

    expect(summary).toEqual({ fecha: EXPECTED_FECHA, organizationsProcessed: 0, failures: 0 });
    expect(metrics.size()).toBe(0);
  });

  it('defaults now to clock.now() when not provided', async () => {
    const { organizations, metrics, useCase } = buildDeps();
    const orgA = oid('org-default-now');
    await organizations.save(buildOrganization(orgA, 'Org Default Now', 'org-default-now-slug'));

    await useCase();

    expect(await metrics.findByOrgAndDate(orgA, EXPECTED_FECHA)).not.toBeNull();
  });
});
