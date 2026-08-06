import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * Organization's OWN status union (design D10, supersedes D9). Split from
 * the shared `LifecycleStatus` — `Organization` no longer shares a value
 * set or a transition table with `User`. `CANCELLED` is terminal (see
 * `ORGANIZATION_STATUS_TRANSITIONS` in `transitions.ts`): no edge leaves
 * it, for any actor.
 */
export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

const VALID_STATUSES: ReadonlySet<string> = new Set<OrganizationStatus>([
  'ACTIVE',
  'SUSPENDED',
  'CANCELLED',
]);

export function createOrganizationStatus(value: string): OrganizationStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('OrganizationStatus must be one of ACTIVE, SUSPENDED, CANCELLED', {
      value,
    });
  }
  return value as OrganizationStatus;
}
