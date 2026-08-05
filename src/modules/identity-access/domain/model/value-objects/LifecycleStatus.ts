import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * One status union shared by both `Organization` and `User` (design D9) —
 * identical value sets, distinct transition tables (`transitions.ts`).
 */
export type LifecycleStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'DISABLED';

const VALID_STATUSES: ReadonlySet<string> = new Set<LifecycleStatus>([
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'DISABLED',
]);

export function createLifecycleStatus(value: string): LifecycleStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('LifecycleStatus must be one of ACTIVE, INACTIVE, SUSPENDED, DISABLED', {
      value,
    });
  }
  return value as LifecycleStatus;
}
