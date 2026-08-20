import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenRole } from '../../domain/errors/IngestError.js';

/**
 * Gate on `AuthContext.roleId` for role-restricted ingest operations
 * (design D6: inbound secret upsert requires SUPERVISOR|ADMIN).
 */
export function requireRole(auth: AuthContext, allowed: readonly string[]): void {
  if (auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
