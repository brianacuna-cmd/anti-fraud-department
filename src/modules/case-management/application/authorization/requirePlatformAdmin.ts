import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/CaseManagementError.js';

/**
 * Module-local PLATFORM_ADMIN guard for DLQ administration use cases (D1).
 *
 * A twin of `identity-access`'s `requirePlatformAdmin` — cross-module
 * `application` imports are rejected by eslint `boundaries/element-types`, so
 * each module owns its guard. Mirrors the existing `requireTenantContext` twin
 * pattern. Reads `actorType`, not `isPlatformAdmin`, per design D11/D12.
 *
 * Throws `forbiddenCrossTenant` so the HTTP error handler maps it to 403
 * without any additional case — `caseManagementErrorStatus.FORBIDDEN_CROSS_TENANT`
 * is already wired to 403.
 */
export function requirePlatformAdmin(auth: AuthContext): void {
  if (auth.actorType !== 'PLATFORM_ADMIN') {
    throw forbiddenCrossTenant('DLQ administration requires a platform administrator');
  }
}
