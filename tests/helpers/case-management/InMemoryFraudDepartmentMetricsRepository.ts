import type { FraudDepartmentMetrics } from '../../../src/modules/case-management/domain/model/aggregates/FraudDepartmentMetrics.js';
import type { FraudDepartmentMetricsRepository } from '../../../src/modules/case-management/domain/ports/FraudDepartmentMetricsRepository.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

function key(organizationId: string, fecha: string): string {
  return `${organizationId}::${fecha}`;
}

/** In-memory fake for unit-testing the aggregator use case (mirrors InMemoryOrganizationFraudConfigRepository). */
export class InMemoryFraudDepartmentMetricsRepository implements FraudDepartmentMetricsRepository {
  private readonly byKey = new Map<string, FraudDepartmentMetrics>();

  seed(metrics: FraudDepartmentMetrics): void {
    this.byKey.set(key(metrics.organizationId, metrics.fecha), metrics);
  }

  async upsert(metrics: FraudDepartmentMetrics, _tx?: Transaction): Promise<void> {
    this.byKey.set(key(metrics.organizationId, metrics.fecha), metrics);
  }

  async findByOrgAndDate(
    organizationId: string,
    fecha: string,
    _tx?: Transaction,
  ): Promise<FraudDepartmentMetrics | null> {
    return this.byKey.get(key(organizationId, fecha)) ?? null;
  }

  size(): number {
    return this.byKey.size;
  }
}
