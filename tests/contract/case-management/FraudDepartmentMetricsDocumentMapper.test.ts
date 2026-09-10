import { oid } from '../../support/oid.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { FraudDepartmentMetrics } from '../../../src/modules/case-management/domain/model/aggregates/FraudDepartmentMetrics.js';
import {
  toDomain,
  toUpsertFields,
} from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/mappers/FraudDepartmentMetricsDocumentMapper.js';
import type { FraudDepartmentMetricsDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/FraudDepartmentMetricsDocument.js';

const NOW = fromDate(new Date('2026-09-09T00:00:00.000Z'));

function buildMetrics(overrides: Partial<Parameters<typeof FraudDepartmentMetrics.create>[0]> = {}) {
  return FraudDepartmentMetrics.create({
    organizationId: oid('org-1'),
    fecha: '2026-09-09',
    casosAbiertos: 4,
    casosCerrados: 3,
    slaCompliancePct: 66.67,
    precisionModelo: 0.5,
    falsePositiveRate: 0.25,
    now: NOW,
    ...overrides,
  });
}

/** Simulates what an atomic $set/$setOnInsert upsert would persist as a raw document. */
function toRawDocument(metrics: FraudDepartmentMetrics): FraudDepartmentMetricsDocument {
  const { key, set, setOnInsert } = toUpsertFields(metrics);
  return { ...setOnInsert, ...key, ...set };
}

describe('FraudDepartmentMetricsDocumentMapper', () => {
  it('round-trips all fields through toUpsertFields -> raw document -> toDomain', () => {
    const metrics = buildMetrics();

    const rehydrated = toDomain(toRawDocument(metrics));

    expect(rehydrated.organizationId).toBe(metrics.organizationId);
    expect(rehydrated.fecha).toBe('2026-09-09');
    expect(rehydrated.casosAbiertos).toBe(4);
    expect(rehydrated.casosCerrados).toBe(3);
    expect(rehydrated.slaCompliancePct).toBe(66.67);
    expect(rehydrated.precisionModelo).toBe(0.5);
    expect(rehydrated.falsePositiveRate).toBe(0.25);
    expect(rehydrated.createdAt).toEqual(NOW);
  });

  it('preserves null ratio fields (zero-activity row)', () => {
    const metrics = buildMetrics({
      casosAbiertos: 0,
      casosCerrados: 0,
      slaCompliancePct: null,
      precisionModelo: null,
      falsePositiveRate: null,
    });

    const rehydrated = toDomain(toRawDocument(metrics));

    expect(rehydrated.casosAbiertos).toBe(0);
    expect(rehydrated.casosCerrados).toBe(0);
    expect(rehydrated.slaCompliancePct).toBeNull();
    expect(rehydrated.precisionModelo).toBeNull();
    expect(rehydrated.falsePositiveRate).toBeNull();
  });

  it('toUpsertFields keys on the natural key (organization_id, fecha)', () => {
    const metrics = buildMetrics();

    const { key } = toUpsertFields(metrics);

    expect(key.organization_id.toString()).toBe(oid('org-1'));
    expect(key.fecha).toBe('2026-09-09');
  });
});
