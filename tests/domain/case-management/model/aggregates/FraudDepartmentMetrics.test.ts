import { FraudDepartmentMetrics } from '../../../../../src/modules/case-management/domain/model/aggregates/FraudDepartmentMetrics.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-09-10T00:00:00.000Z'));

function buildMetrics(
  overrides: Partial<Parameters<typeof FraudDepartmentMetrics.create>[0]> = {},
): FraudDepartmentMetrics {
  return FraudDepartmentMetrics.create({
    organizationId: 'org-1',
    fecha: '2026-09-09',
    casosAbiertos: 5,
    casosCerrados: 3,
    slaCompliancePct: 75.5,
    precisionModelo: 0.6667,
    falsePositiveRate: 0.25,
    now: NOW,
    ...overrides,
  });
}

describe('FraudDepartmentMetrics.create', () => {
  it('creates a row with all fields set', () => {
    const metrics = buildMetrics();

    expect(metrics.organizationId).toBe('org-1');
    expect(metrics.fecha).toBe('2026-09-09');
    expect(metrics.casosAbiertos).toBe(5);
    expect(metrics.casosCerrados).toBe(3);
    expect(metrics.slaCompliancePct).toBe(75.5);
    expect(metrics.precisionModelo).toBe(0.6667);
    expect(metrics.falsePositiveRate).toBe(0.25);
    expect(metrics.createdAt).toBe(NOW);
  });

  it('allows all 3 ratio fields to be null (zero-activity day)', () => {
    const metrics = buildMetrics({
      casosAbiertos: 0,
      casosCerrados: 0,
      slaCompliancePct: null,
      precisionModelo: null,
      falsePositiveRate: null,
    });

    expect(metrics.slaCompliancePct).toBeNull();
    expect(metrics.precisionModelo).toBeNull();
    expect(metrics.falsePositiveRate).toBeNull();
  });

  it('rejects an empty organizationId', () => {
    expect(() => buildMetrics({ organizationId: '   ' })).toThrow(CaseManagementError);
  });

  it.each([
    ['2026-9-9', 'unpadded month/day'],
    ['2026/09/09', 'wrong separator'],
    ['not-a-date', 'garbage'],
    ['2026-13-01', 'invalid month'],
    ['2026-02-30', 'invalid day'],
  ])('rejects an invalid fecha "%s" (%s)', (fecha) => {
    expect(() => buildMetrics({ fecha })).toThrow(CaseManagementError);
  });

  it.each([
    ['casosAbiertos', -1],
    ['casosAbiertos', 1.5],
    ['casosCerrados', -1],
    ['casosCerrados', 2.5],
  ])('rejects a negative or non-integer %s', (field, value) => {
    expect(() => buildMetrics({ [field]: value } as Record<string, unknown>)).toThrow(CaseManagementError);
  });

  it.each([
    ['slaCompliancePct', -0.01],
    ['slaCompliancePct', 100.01],
    ['precisionModelo', -0.01],
    ['precisionModelo', 1.01],
    ['falsePositiveRate', -0.01],
    ['falsePositiveRate', 1.01],
  ])('rejects an out-of-range %s', (field, value) => {
    expect(() => buildMetrics({ [field]: value } as Record<string, unknown>)).toThrow(CaseManagementError);
  });

  it('accepts boundary values 0 and 100 for slaCompliancePct', () => {
    expect(() => buildMetrics({ slaCompliancePct: 0 })).not.toThrow();
    expect(() => buildMetrics({ slaCompliancePct: 100 })).not.toThrow();
  });

  it('accepts boundary values 0 and 1 for precisionModelo/falsePositiveRate', () => {
    expect(() => buildMetrics({ precisionModelo: 0, falsePositiveRate: 1 })).not.toThrow();
  });
});

describe('FraudDepartmentMetrics.rehydrate', () => {
  it('round-trips props unchanged', () => {
    const created = buildMetrics();
    const rehydrated = FraudDepartmentMetrics.rehydrate(created.toProps());

    expect(rehydrated.toProps()).toEqual(created.toProps());
  });
});
