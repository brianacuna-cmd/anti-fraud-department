import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/IdentityAccessError.js';

/**
 * Coarse authorization guard for every `/organizations` use case (design
 * D3): route reachability is not a domain fact, so this lives in the
 * application layer and runs before any domain logic. Reads `actorType`,
 * not `isPlatformAdmin`, per design D11/D12 — `actorType` is what a real
 * session resolves; `isPlatformAdmin` stays on `AuthContext` only for the
 * unrelated `TransitionActor` reactivation gate (design D2).
 */
export function requirePlatformAdmin(auth: AuthContext): void {
  if (auth.actorType !== 'PLATFORM_ADMIN') {
    throw forbiddenCrossTenant('organizations routes require a platform administrator');
  }
}
