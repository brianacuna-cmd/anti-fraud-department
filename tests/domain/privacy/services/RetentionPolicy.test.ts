import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { SubjectRecord } from '../../../../src/modules/privacy/domain/ports/SubjectDataSource.js';
import {
  planErasure,
  resolutionFor,
} from '../../../../src/modules/privacy/domain/services/RetentionPolicy.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function record(id: string, retainedUntil: string | null, basis: string | null = null): SubjectRecord {
  return {
    kind: 'case',
    id,
    openedAt: fromDate(new Date('2020-01-01T00:00:00.000Z')),
    closedAt: null,
    retainedUntil: retainedUntil === null ? null : fromDate(new Date(retainedUntil)),
    retentionBasis: basis,
    personalData: {},
    retainedData: {},
  };
}

describe('planErasure', () => {
  it('sin deber de retención, todo es borrable', () => {
    const plan = planErasure([record('a', null), record('b', null)], NOW);

    expect(plan.erasable.map((r) => r.id)).toEqual(['a', 'b']);
    expect(plan.barred).toHaveLength(0);
    expect(plan.barredUntil).toBeNull();
    expect(resolutionFor(plan)).toBe('FULFILLED');
  });

  it('una retención ya vencida deja de proteger el registro', () => {
    // El límite es "<= ahora": vencido ayer y vencido hoy mismo se borran los dos.
    const plan = planErasure(
      [
        record('vencido-ayer', '2025-12-31T00:00:00.000Z', 'AML'),
        record('vence-hoy', '2026-01-01T00:00:00.000Z', 'AML'),
      ],
      NOW,
    );

    expect(plan.erasable.map((r) => r.id)).toEqual(['vencido-ayer', 'vence-hoy']);
    expect(plan.barred).toHaveLength(0);
  });

  it('separa lo borrable de lo retenido y devuelve la fecha MÁS LEJANA', () => {
    const plan = planErasure(
      [
        record('libre', null),
        record('retenido-2029', '2029-06-01T00:00:00.000Z', 'AML 5 años'),
        record('retenido-2031', '2031-03-01T00:00:00.000Z', 'AML 5 años'),
      ],
      NOW,
    );

    expect(plan.erasable.map((r) => r.id)).toEqual(['libre']);
    expect(plan.barred.map((r) => r.id)).toEqual(['retenido-2029', 'retenido-2031']);
    // La fecha que se le da al titular es la última, no la primera: volver en
    // 2029 no le serviría de nada porque en 2029 todavía quedaría un registro.
    expect(plan.barredUntil).toBe(fromDate(new Date('2031-03-01T00:00:00.000Z')));
    expect(plan.bases).toEqual(['AML 5 años']);
  });

  it('si algo se retuvo, el resultado es PARCIAL aunque se haya borrado casi todo', () => {
    const plan = planErasure(
      [record('a', null), record('b', null), record('c', '2031-01-01T00:00:00.000Z', 'AML')],
      NOW,
    );

    expect(plan.erasable).toHaveLength(2);
    // Declararlo FULFILLED sería afirmar que se borró algo que sigue ahí.
    expect(resolutionFor(plan)).toBe('PARTIALLY_FULFILLED');
  });

  it('sin registros: nada que borrar y nada que retener', () => {
    const plan = planErasure([], NOW);

    expect(plan.erasable).toHaveLength(0);
    expect(plan.barred).toHaveLength(0);
    expect(plan.barredUntil).toBeNull();
    expect(resolutionFor(plan)).toBe('FULFILLED');
  });

  it('deduplica las bases legales invocadas', () => {
    const plan = planErasure(
      [
        record('a', '2031-01-01T00:00:00.000Z', 'AML 5 años'),
        record('b', '2032-01-01T00:00:00.000Z', 'AML 5 años'),
        record('c', '2033-01-01T00:00:00.000Z', 'Orden judicial'),
      ],
      NOW,
    );

    expect([...plan.bases].sort()).toEqual(['AML 5 años', 'Orden judicial']);
  });
});
