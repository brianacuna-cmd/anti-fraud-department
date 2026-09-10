import { InMemoryFraudDepartmentMetricsRepository } from './InMemoryFraudDepartmentMetricsRepository.js';
import { FraudDepartmentMetrics } from '../../../src/modules/case-management/domain/model/aggregates/FraudDepartmentMetrics.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-09-10T00:00:00.000Z'));

function buildMetrics(
  overrides: Partial<Parameters<typeof FraudDepartmentMetrics.create>[0]> = {},
): FraudDepartmentMetrics {
  return FraudDepartmentMetrics.create({
    organizationId: 'org-1',
    fecha: '2026-09-09',
    casosAbiertos: 1,
    casosCerrados: 1,
    slaCompliancePct: 100,
    precisionModelo: 1,
    falsePositiveRate: 0,
    now: NOW,
    ...overrides,
  });
}

describe('InMemoryFraudDepartmentMetricsRepository', () => {
  it('upsert on the same (organizationId, fecha) overwrites instead of duplicating', async () => {
    const repo = new InMemoryFraudDepartmentMetricsRepository();

    await repo.upsert(buildMetrics({ casosAbiertos: 2 }));
    await repo.upsert(buildMetrics({ casosAbiertos: 5 }));

    expect(repo.size()).toBe(1);
    const found = await repo.findByOrgAndDate('org-1', '2026-09-09');
    expect(found?.casosAbiertos).toBe(5);
  });

  it('keeps separate rows for different fecha values of the same org', async () => {
    const repo = new InMemoryFraudDepartmentMetricsRepository();

    await repo.upsert(buildMetrics({ fecha: '2026-09-08' }));
    await repo.upsert(buildMetrics({ fecha: '2026-09-09' }));

    expect(repo.size()).toBe(2);
  });

  it('returns null when no row exists for the given key', async () => {
    const repo = new InMemoryFraudDepartmentMetricsRepository();

    expect(await repo.findByOrgAndDate('org-x', '2026-09-09')).toBeNull();
  });
});
