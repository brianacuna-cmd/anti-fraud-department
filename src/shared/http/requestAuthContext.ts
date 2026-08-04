import type { Request } from 'express';
import type { AuthContext } from '../kernel/AuthContext.js';

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
 * Reads the `AuthContext` a router handler needs. Throws if no upstream
 * middleware ever attached one — a wiring bug, not a request-time 4xx.
 */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.authContext) {
    throw new Error('AuthContext missing on request — authContextMiddleware must run before this route');
  }
  return req.authContext;
}
