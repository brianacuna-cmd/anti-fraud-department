import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/IngestError.js';

/**
 * Narrows `AuthContext.organizationId` from `string | null` back to
 * `string` for tenant-scoped ingest use cases (clone of scoring/case).
 */
export function requireTenantContext(auth: AuthContext): string {
  if (auth.organizationId === null) {
    throw forbiddenCrossTenant('this operation requires an organization context');
  }
  return auth.organizationId;
}
