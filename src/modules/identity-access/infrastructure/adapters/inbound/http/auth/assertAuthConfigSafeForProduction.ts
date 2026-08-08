const UNSAFE_AUTH_MODE = 'trusted-header';
const UNSAFE_PLATFORM_ADMIN_AUTH = 'trusted-header';
const PRODUCTION_ENV = 'production';

/**
 * Fail-closed startup guard (design D6, renamed from
 * `assertAuthModeSafeForProduction`) — now TIER-AWARE:
 *
 * - `AUTH_MODE=trusted-header` (USER/ORG global bypass) trusts
 *   client-supplied headers verbatim and must never run when
 *   `NODE_ENV=production` (unchanged from the pre-D6 guard).
 * - `AUTH_MODE=session` is now production-SAFE (design D6 — USER/ORG no
 *   longer wait on the unbuilt PLATFORM_ADMIN login) — no longer rejected.
 * - `PLATFORM_ADMIN_AUTH=trusted-header` is production-FORBIDDEN for every
 *   tier: it is an interim, non-prod-only escape hatch for PLATFORM_ADMIN
 *   until `identity-access-super-admin-auth` ships a real login. In
 *   production this must stay `disabled` (the default) — PLATFORM_ADMIN
 *   requests simply 401 until then, an explicit, logged unavailability
 *   rather than a silent trust of arbitrary headers.
 *
 * Called once during `main.ts` bootstrap, before any route is mounted.
 */
export function assertAuthConfigSafeForProduction(
  nodeEnv: string | undefined,
  authMode: string | undefined,
  platformAdminAuth: string | undefined,
): void {
  if (nodeEnv === PRODUCTION_ENV && authMode === UNSAFE_AUTH_MODE) {
    throw new Error(
      `AUTH_MODE=${UNSAFE_AUTH_MODE} is not allowed when NODE_ENV=${PRODUCTION_ENV} — ` +
        'configure a real auth resolver before deploying.',
    );
  }

  if (nodeEnv === PRODUCTION_ENV && platformAdminAuth === UNSAFE_PLATFORM_ADMIN_AUTH) {
    throw new Error(
      `PLATFORM_ADMIN_AUTH=${UNSAFE_PLATFORM_ADMIN_AUTH} is not allowed when NODE_ENV=${PRODUCTION_ENV} — ` +
        'PLATFORM_ADMIN auth stays disabled in production until a real admin login ships.',
    );
  }
}
