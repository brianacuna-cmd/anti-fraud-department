import { diffFields } from '../../../src/modules/audit/domain/services/diffFields.js';

describe('diffFields', () => {
  it('un alta no produce mutaciones', () => {
    // `audit_logs` ya registra la creación con su acción propia; volcar aquí
    // los treinta campos del documento nuevo duplicaría ese hecho.
    expect(diffFields(null, { status: 'OPEN', priority: 'HIGH' })).toEqual([]);
  });

  it('guardar un documento idéntico no produce nada', () => {
    const doc = { status: 'OPEN', priority: 'HIGH', tags: ['a', 'b'] };
    expect(diffFields(doc, { ...doc, tags: ['a', 'b'] })).toEqual([]);
  });

  it('registra el antes y el después de cada campo que cambió', () => {
    const antes = { status: 'OPEN', priority: 'LOW', risk_score: 40 };
    const despues = { status: 'IN_REVIEW', priority: 'LOW', risk_score: 92 };

    expect(diffFields(antes, despues)).toEqual([
      { field: 'risk_score', previousValue: 40, newValue: 92 },
      { field: 'status', previousValue: 'OPEN', newValue: 'IN_REVIEW' },
    ]);
  });

  it('el orden es estable, alfabético', () => {
    // Dos escrituras equivalentes deben producir la misma fila, o comparar dos
    // registros de cambios se vuelve imposible.
    const a = diffFields({ z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 });
    const b = diffFields({ a: 1, m: 1, z: 1 }, { a: 2, m: 2, z: 2 });
    expect(a.map((x) => x.field)).toEqual(['a', 'm', 'z']);
    expect(a).toEqual(b);
  });

  it('NUNCA registra secretos', () => {
    const mutaciones = diffFields(
      { password_hash: 'viejo', mfa_secret: 's1', status: 'OPEN' },
      { password_hash: 'nuevo', mfa_secret: 's2', status: 'RESOLVED' },
    );

    // Copiarlos crearía una segunda copia permanente de una credencial en la
    // única tabla que nadie puede borrar.
    expect(mutaciones.map((m) => m.field)).toEqual(['status']);
  });

  it('ignora updated_at, que cambia en cada escritura', () => {
    const mutaciones = diffFields(
      { updated_at: new Date('2026-01-01'), status: 'OPEN' },
      { updated_at: new Date('2026-02-01'), status: 'RESOLVED' },
    );
    expect(mutaciones.map((m) => m.field)).toEqual(['status']);
  });

  it('dos fechas con el mismo instante no son un cambio', () => {
    const mutaciones = diffFields(
      { due_date: new Date('2026-03-01T00:00:00.000Z') },
      { due_date: new Date('2026-03-01T00:00:00.000Z') },
    );
    expect(mutaciones).toEqual([]);
  });

  it('un campo anidado que cambia cuenta como UNA mutación, no como muchas', () => {
    // Un snapshot de proveedor produciría cientos de mutaciones por cada
    // sincronización y ahogaría los cambios que importan.
    const mutaciones = diffFields(
      { snapshot: { a: 1, b: 2, c: 3 } },
      { snapshot: { a: 9, b: 9, c: 9 } },
    );
    expect(mutaciones).toHaveLength(1);
    expect(mutaciones[0]!.field).toBe('snapshot');
  });

  it('un campo que aparece o desaparece se registra contra null', () => {
    expect(diffFields({ status: 'OPEN' }, { status: 'OPEN', assigned_to: 'u1' })).toEqual([
      { field: 'assigned_to', previousValue: null, newValue: 'u1' },
    ]);
    expect(diffFields({ status: 'OPEN', assigned_to: 'u1' }, { status: 'OPEN' })).toEqual([
      { field: 'assigned_to', previousValue: 'u1', newValue: null },
    ]);
  });
});
