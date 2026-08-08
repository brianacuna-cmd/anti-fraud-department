import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import type { AuthContextResolver } from './AuthContextResolver.js';

const PLATFORM_ADMIN = 'PLATFORM_ADMIN';

/**
 * Per-tier auth-mode decoupling (design D6). `AUTH_MODE=session` is now
 * production-safe for USER/ORGANIZATION, but PLATFORM_ADMIN has no
 * session-issuing login yet — this composite lets USER/ORG run fully on
 * `SessionTokenAuthContextResolver` (the `primary`) while PLATFORM_ADMIN
 * gets an OPT-IN, admin-ONLY interim path via `adminInterim`
 * (`TrustedHeaderAuthContextResolver`, only constructed by
 * `resolveAuthContextResolver` when `PLATFORM_ADMIN_AUTH=trusted-header`).
 *
 * Fallback ordering is deliberate and security-critical:
 * 1. `primary` always runs first — it is the ONLY path USER/ORG ever take.
 * 2. `adminInterim` is consulted ONLY when `primary` returns `null` AND
 *    `adminInterim` is non-null (i.e. `PLATFORM_ADMIN_AUTH=trusted-header`).
 * 3. Even then, its result is honored ONLY when `actorType==='PLATFORM_ADMIN'`
 *    — a header-resolved USER/ORG context is discarded, never returned. This
 *    guarantees USER/ORG requests NEVER resolve through the trusted-header
 *    path, no matter how `PLATFORM_ADMIN_AUTH` is configured.
 * 4. `adminInterim===null` (`PLATFORM_ADMIN_AUTH=disabled`, the default)
 *    means PLATFORM_ADMIN requests resolve to `null` — an explicit,
 *    logged-at-startup unavailability, not a silent, unexplained 401.
 */
export class TieredAuthContextResolver implements AuthContextResolver {
  constructor(
    private readonly primary: AuthContextResolver,
    private readonly adminInterim: AuthContextResolver | null,
  ) {}

  async resolve(req: Request): Promise<AuthContext | null> {
    const context = await this.primary.resolve(req);
    if (context) {
      return context;
    }

    if (!this.adminInterim) {
      return null;
    }

    const adminContext = await this.adminInterim.resolve(req);
    if (adminContext?.actorType === PLATFORM_ADMIN) {
      return adminContext;
    }

    return null;
  }
}
