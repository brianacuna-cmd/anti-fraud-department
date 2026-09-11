import type { FieldMutation } from '../model/aggregates/EntityChange.js';

/**
 * Campos que NUNCA se registran, por nombre.
 *
 * Dos razones distintas conviven aquí. `password_hash`, `mfa_secret` y
 * compañía son secretos: copiarlos al registro de cambios crearía una segunda
 * copia permanente de una credencial en la única tabla que nadie puede borrar.
 * `updated_at` es ruido: cambia en cada escritura, así que registrarlo
 * convertiría todo cambio real en un cambio de dos campos y llenaría la
 * colección de filas que no dicen nada.
 */
const NEVER_TRACKED: ReadonlySet<string> = new Set([
  'password_hash',
  'reset_token_hash',
  'mfa_secret',
  'code_otp',
  'secret',
  'updated_at',
  '_id',
]);

/** Comparación estructural barata para valores de documento. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  // Objetos y arrays: se comparan serializados. Es suficiente para documentos
  // planos y evita traerse una librería de igualdad profunda por esto.
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Qué cambió entre dos versiones de un documento (AUD-001).
 *
 * Compara campo a campo el nivel superior, no en profundidad. Es deliberado:
 * un `finturu_cache_snapshot` anidado produciría cientos de mutaciones por
 * cada sincronización y ahogaría los cambios que importan —quién reasignó un
 * caso, quién subió una prioridad— entre ruido de un tercero. Lo que se
 * registra es que ese campo cambió, no cada hoja de su interior.
 */
export function diffFields(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>,
): readonly FieldMutation[] {
  const mutations: FieldMutation[] = [];

  /*
   * Sin versión anterior es un ALTA, y un alta no es una mutación.
   *
   * `audit_logs` ya registra la creación con su acción propia; volcar aquí los
   * treinta campos del documento nuevo como "cambios" duplicaría ese hecho y
   * además haría que la primera fila de cada entidad fuera la más ruidosa de
   * su historia.
   */
  if (before === null) return mutations;

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = fields.filter(
    (field) => !NEVER_TRACKED.has(field) && !sameValue(before[field], after[field]),
  );

  for (const field of changed) {
    mutations.push({
      field,
      previousValue: before[field] ?? null,
      newValue: after[field] ?? null,
    });
  }

  // Orden estable por nombre: dos escrituras equivalentes deben producir la
  // misma fila, o comparar dos registros de cambios se vuelve imposible.
  return mutations.sort((a, b) => a.field.localeCompare(b.field));
}
