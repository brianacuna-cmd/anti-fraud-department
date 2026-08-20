import type { AuthContextResolver } from './AuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from './TrustedHeaderAuthContextResolver.js';
import { SessionTokenAuthContextResolver } from './SessionTokenAuthContextResolver.js';
import { TieredAuthContextResolver } from './TieredAuthContextResolver.js';
import type { SessionTokenService } from '../../../../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../../../../domain/ports/SessionRepository.js';
import type { UserRepositoryFactory } from '../../../../../domain/ports/UserRepositoryFactory.js';

const TRUSTED_HEADER_MODE = 'trusted-header';
const SESSION_MODE = 'session';
const PLATFORM_ADMIN_AUTH_TRUSTED_HEADER = 'trusted-header';

/** Only consulted for `AUTH_MODE=session` (design D6/D12) — every other mode ignores these. */
export interface AuthContextResolverDeps {
  readonly sessionTokenService?: SessionTokenService;
  readonly sessionRepository?: SessionRepository;
  /** Resuelve el rol del usuario en cada peticion, para poblar `AuthContext.roleId`. */
  readonly userRepositoryFactory?: UserRepositoryFactory;
  /**
   * Design D6: `'disabled'` (default, prod-safe) or `'trusted-header'`
   * (non-prod-only, interim PLATFORM_ADMIN path — `assertAuthConfigSafeForProduction`
   * refuses to let it start in production). Absent/anything else behaves as
   * `'disabled'`.
   */
  readonly platformAdminAuth?: string;
}

/**
 * Selects the concrete `AuthContextResolver` for the configured `AUTH_MODE`
 * (design D4, D6, D12).
 *
 * `AUTH_MODE=session` is now production-safe for USER/ORGANIZATION on its
 * own (design D6 — no longer coupled to the unbuilt PLATFORM_ADMIN login):
 * it is wired as a `TieredAuthContextResolver` whose PRIMARY is the real
 * `SessionTokenAuthContextResolver` (USER/ORG Bearer tokens + scoped MFA
 * tokens). PLATFORM_ADMIN gets an explicit, OPT-IN, admin-ONLY interim
 * fallback — a `TrustedHeaderAuthContextResolver` — constructed here ONLY
 * when `platformAdminAuth==='trusted-header'`; when omitted/`'disabled'`
 * (the default) no fallback is wired at all, so a PLATFORM_ADMIN request
 * resolves to `null` (an explicit, logged-at-startup unavailability, not a
 * silently mis-authenticated request). `assertAuthConfigSafeForProduction`
 * refuses to start with `platformAdminAuth==='trusted-header'` in
 * production, so this interim path never reaches prod.
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
    if (!deps.userRepositoryFactory) {
      // Sin el, `roleId` seria siempre null y todas las guardas de rol
      // rechazarian: mejor no arrancar que servir un 403 permanente.
      throw new Error('AUTH_MODE=session requires userRepositoryFactory to resolve the caller role');
    }
    const primary = new SessionTokenAuthContextResolver(
      deps.sessionTokenService,
      deps.sessionRepository,
      deps.userRepositoryFactory,
    );
    const adminInterim =
      deps.platformAdminAuth === PLATFORM_ADMIN_AUTH_TRUSTED_HEADER ? new TrustedHeaderAuthContextResolver() : null;
    return new TieredAuthContextResolver(primary, adminInterim);
  }
  throw new Error(
    `Unsupported AUTH_MODE "${authMode}": only "${TRUSTED_HEADER_MODE}" or "${SESSION_MODE}" is currently supported.`,
  );
}
