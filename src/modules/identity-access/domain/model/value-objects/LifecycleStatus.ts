import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * `User`-only status union (design D10, supersedes D9). Previously shared
 * with `Organization`; D10 split that off into its own `OrganizationStatus`
 * (`OrganizationStatus.ts`) with its own 3-value set and transition table
 * (`ORGANIZATION_STATUS_TRANSITIONS`) — `Organization` no longer uses this
 * type at all.
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
