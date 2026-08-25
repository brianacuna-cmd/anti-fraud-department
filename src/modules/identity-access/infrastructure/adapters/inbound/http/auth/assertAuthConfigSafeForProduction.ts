const UNSAFE_AUTH_MODE = 'trusted-header';
/**
 * El valor al que `main.ts` cae cuando `TOKEN_SECRET` no esta puesto. Sirve
 * para arrancar en local sin ceremonia; en produccion firma sesiones con una
 * cadena que esta publicada en este mismo repositorio.
 */
export const DEV_TOKEN_SECRET = 'dev-only-insecure-token-secret';
/**
 * Minimo para el secreto de firma. No pretende medir entropia -- solo corta el
 * caso en que alguien "lo configura" con `TOKEN_SECRET=cambiar`, que pasa el
 * filtro del valor por defecto y no vale mas que el.
 */
const MIN_TOKEN_SECRET_LENGTH = 32;
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
 * - `TOKEN_SECRET` sin configurar deja a `main.ts` cayendo en un valor por
 *   defecto que esta escrito en el repositorio. Quien lo lea puede firmar
 *   tokens de sesion validos para cualquier inquilino: no es una configuracion
 *   floja, es no tener autenticacion. En produccion tiene que estar puesto y
 *   tener longitud suficiente.
 *
 * Called once during `main.ts` bootstrap, before any route is mounted.
 */
export function assertAuthConfigSafeForProduction(
  nodeEnv: string | undefined,
  authMode: string | undefined,
  platformAdminAuth: string | undefined,
  tokenSecret?: string | undefined,
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

  if (nodeEnv === PRODUCTION_ENV) {
    assertTokenSecretUsable(tokenSecret);
  }
}

function assertTokenSecretUsable(tokenSecret: string | undefined): void {
  if (tokenSecret === undefined || tokenSecret.trim().length === 0) {
    throw new Error(
      `TOKEN_SECRET must be set when NODE_ENV=${PRODUCTION_ENV} — ` +
        'without it sessions are signed with a default published in this repository.',
    );
  }

  if (tokenSecret === DEV_TOKEN_SECRET) {
    throw new Error(
      `TOKEN_SECRET is still the development default when NODE_ENV=${PRODUCTION_ENV} — ` +
        'anyone who can read this repository can mint valid sessions for any tenant.',
    );
  }

  if (tokenSecret.length < MIN_TOKEN_SECRET_LENGTH) {
    throw new Error(
      `TOKEN_SECRET must be at least ${MIN_TOKEN_SECRET_LENGTH} characters when ` +
        `NODE_ENV=${PRODUCTION_ENV} — got ${tokenSecret.length}.`,
    );
  }
}
