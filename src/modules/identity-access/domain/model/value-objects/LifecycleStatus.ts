import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * One status union shared by both `Organization` and `User` (design D9) —
 * identical value sets, distinct transition tables (`transitions.ts`).
 */
export type LifecycleStatus = 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO' | 'DESHABILITADO';

const VALID_STATUSES: ReadonlySet<string> = new Set<LifecycleStatus>([
  'ACTIVO',
  'INACTIVO',
  'SUSPENDIDO',
  'DESHABILITADO',
]);

export function createLifecycleStatus(value: string): LifecycleStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('LifecycleStatus must be one of ACTIVO, INACTIVO, SUSPENDIDO, DESHABILITADO', {
      value,
    });
  }
  return value as LifecycleStatus;
}
