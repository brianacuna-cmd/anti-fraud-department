import type { Request } from 'express';
import type { AuthContext } from '../kernel/AuthContext.js';
import { AuthScopeError } from '../kernel/AuthScopeError.js';
import { UnauthenticatedError } from '../kernel/UnauthenticatedError.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

/**
 * Attaches the resolved `AuthContext` to the request (design Data Flow:
 * "HTTP -> authContextMiddleware -> router"). The real
 * `TrustedHeaderAuthContextResolver` + `authContextMiddleware` (Phase 3)
 * call this; Phase 2's own e2e tests call it directly from a tiny
 * test-only middleware.
 */
export function attachAuthContext(req: Request, auth: AuthContext): void {
  req.authContext = auth;
}

/**
 * Reads whichever `AuthContext` was attached, at ANY `purpose` — the raw
 * accessor `requireScopedAuthContext` (identity-access/application) builds
 * its own allow-list check on top of (design D3). Throws if no upstream
 * middleware ever attached one — a wiring bug, not a request-time 4xx.
 */
export function requireAuthContextAnyScope(req: Request): AuthContext {
  if (!req.authContext) {
    // Un token ausente/expirado/revocado hace que el resolver no adjunte
    // nada — es un 401 de request, no un bug de wiring (el middleware
    // siempre corre; simplemente no resolvió nada).
    throw new UnauthenticatedError();
  }
  return req.authContext;
}

/**
 * Reads the `AuthContext` a router handler needs, DEFAULT-DENYING any scope
 * other than `'full'` (design D3: "a forgotten route stays protected").
 * `mfa_challenge`/`mfa_enrollment`-scoped contexts carry no real `Sessions`
 * row — every protected route must reject them; only a route that opts in
 * via `requireScopedAuthContext`'s explicit allow-list may accept one.
 */
export function requireAuthContext(req: Request): AuthContext {
  const auth = requireAuthContextAnyScope(req);
  if (auth.purpose !== 'full') {
    throw new AuthScopeError(
      `this route requires a full-scope AuthContext, got "${auth.purpose}"`,
      { purpose: auth.purpose },
    );
  }
  return auth;
}
