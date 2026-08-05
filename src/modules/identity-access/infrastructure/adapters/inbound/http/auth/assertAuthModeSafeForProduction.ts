const UNSAFE_AUTH_MODE = 'trusted-header';
const PRODUCTION_ENV = 'production';

/**
 * Fail-closed startup guard (design D4): `AUTH_MODE=trusted-header` trusts
 * client-supplied headers verbatim and must never run when
 * `NODE_ENV=production`. Called once during `main.ts` bootstrap, before any
 * route is mounted.
 */
export function assertAuthModeSafeForProduction(nodeEnv: string | undefined, authMode: string | undefined): void {
  if (nodeEnv === PRODUCTION_ENV && authMode === UNSAFE_AUTH_MODE) {
    throw new Error(
      `AUTH_MODE=${UNSAFE_AUTH_MODE} is not allowed when NODE_ENV=${PRODUCTION_ENV} — ` +
        'configure a real auth resolver before deploying.',
    );
  }
}
