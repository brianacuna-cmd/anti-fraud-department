import type { AuthContextResolver } from './AuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from './TrustedHeaderAuthContextResolver.js';
import { SessionTokenAuthContextResolver } from './SessionTokenAuthContextResolver.js';
import type { SessionTokenService } from '../../../../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../../../../domain/ports/SessionRepository.js';

const TRUSTED_HEADER_MODE = 'trusted-header';
const SESSION_MODE = 'session';

/** Only consulted for `AUTH_MODE=session` (design D12) — every other mode ignores it. */
export interface AuthContextResolverDeps {
  readonly sessionTokenService?: SessionTokenService;
  readonly sessionRepository?: SessionRepository;
}

/**
 * Selects the concrete `AuthContextResolver` for the configured `AUTH_MODE`
 * (design D4, D12). `AUTH_MODE=session` is NOT production-ready on its own
 * (design "Migration / Rollout": not safe until `identity-access-super-
 * admin-auth` also ships) — that gate is enforced elsewhere
 * (`assertAuthModeSafeForProduction` covers `trusted-header` only today);
 * this function only wires the resolver, it does not gate readiness.
 */
export function resolveAuthContextResolver(
  authMode: string,
  deps: AuthContextResolverDeps = {},
): AuthContextResolver {
  if (authMode === TRUSTED_HEADER_MODE) {
    return new TrustedHeaderAuthContextResolver();
  }
  if (authMode === SESSION_MODE) {
    if (!deps.sessionTokenService || !deps.sessionRepository) {
      throw new Error(
        `AUTH_MODE=${SESSION_MODE} requires both a sessionTokenService and a sessionRepository dependency.`,
      );
    }
    return new SessionTokenAuthContextResolver(deps.sessionTokenService, deps.sessionRepository);
  }
  throw new Error(
    `Unsupported AUTH_MODE "${authMode}": only "${TRUSTED_HEADER_MODE}" or "${SESSION_MODE}" is currently supported.`,
  );
}
