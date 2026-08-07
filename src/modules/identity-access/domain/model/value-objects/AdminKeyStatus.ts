import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * Lifecycle of a single `AdminKey` embedded array element (design D31/D31a).
 * Distinct from `LifecycleStatus`: this is per-key, not per-aggregate — the
 * `AdminOrganization` aggregate itself carries no lifecycle `status` at all,
 * key revocation *is* deactivation.
 */
export type AdminKeyStatus = 'ACTIVE' | 'DEPRECATED' | 'REVOKED';

const VALID_STATUSES: ReadonlySet<string> = new Set<AdminKeyStatus>(['ACTIVE', 'DEPRECATED', 'REVOKED']);

export function createAdminKeyStatus(value: string): AdminKeyStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('AdminKeyStatus must be one of ACTIVE, DEPRECATED, REVOKED', { value });
  }
  return value as AdminKeyStatus;
}
