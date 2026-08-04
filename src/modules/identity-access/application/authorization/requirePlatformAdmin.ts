import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/IdentityAccessError.js';

/**
 * Coarse authorization guard for every `/organizations` use case (design
 * D3): route reachability is not a domain fact, so this lives in the
 * application layer and runs before any domain logic.
 */
export function requirePlatformAdmin(auth: AuthContext): void {
  if (!auth.isPlatformAdmin) {
    throw forbiddenCrossTenant('organizations routes require a platform administrator');
  }
}
