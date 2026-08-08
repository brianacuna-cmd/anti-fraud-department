import type { Request } from 'express';
import type { AuthContext, AuthContextPurpose } from '../../../../shared/kernel/AuthContext.js';
import { requireAuthContextAnyScope } from '../../../../shared/http/requestAuthContext.js';
import { AuthScopeError } from '../../../../shared/kernel/AuthScopeError.js';

export interface RequireScopedAuthContextOptions {
  readonly allow: readonly AuthContextPurpose[];
}

/**
 * Explicit allow-list guard for the few routes that must accept a
 * non-`'full'` `AuthContext` (design D3) — forced-enrollment's `setup`/
 * `activate` accept `['full', 'enrollment']` so an in-progress enrollment
 * token can complete MFA setup without a real session yet existing.
 * Every OTHER protected route stays on `requireAuthContext`'s blanket
 * default-deny; this is the deliberate, narrow opt-in, never the default.
 */
export function requireScopedAuthContext(
  req: Request,
  options: RequireScopedAuthContextOptions,
): AuthContext {
  const auth = requireAuthContextAnyScope(req);
  if (!options.allow.includes(auth.purpose)) {
    throw new AuthScopeError(
      `this route requires purpose in [${options.allow.join(', ')}], got "${auth.purpose}"`,
      { purpose: auth.purpose, allow: options.allow },
    );
  }
  return auth;
}
