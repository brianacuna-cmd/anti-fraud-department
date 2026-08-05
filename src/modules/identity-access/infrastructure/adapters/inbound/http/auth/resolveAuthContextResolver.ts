import type { AuthContextResolver } from './AuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from './TrustedHeaderAuthContextResolver.js';

const TRUSTED_HEADER_MODE = 'trusted-header';

/**
 * Selects the concrete `AuthContextResolver` for the configured `AUTH_MODE`
 * (design D4). Only `trusted-header` exists today — a real JWT-verifying
 * mode is future work; anything else fails fast with an actionable message
 * rather than silently falling back.
 */
export function resolveAuthContextResolver(authMode: string): AuthContextResolver {
  if (authMode === TRUSTED_HEADER_MODE) {
    return new TrustedHeaderAuthContextResolver();
  }
  throw new Error(
    `Unsupported AUTH_MODE "${authMode}": only "${TRUSTED_HEADER_MODE}" is currently supported.`,
  );
}
