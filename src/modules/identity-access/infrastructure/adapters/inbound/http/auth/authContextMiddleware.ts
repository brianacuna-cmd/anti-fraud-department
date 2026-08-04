import type { RequestHandler } from 'express';
import { attachAuthContext } from '../../../../../../../shared/http/requestAuthContext.js';
import type { AuthContextResolver } from './AuthContextResolver.js';

/**
 * Resolves and attaches the request's `AuthContext` via the given resolver
 * (design Data Flow: "HTTP -> authContextMiddleware -> router"). Always
 * calls `next()` — a request with no resolvable `AuthContext` simply reaches
 * `requireAuthContext` downstream with nothing attached.
 */
export function createAuthContextMiddleware(resolver: AuthContextResolver): RequestHandler {
  return (req, _res, next) => {
    const auth = resolver.resolve(req);
    if (auth) {
      attachAuthContext(req, auth);
    }
    next();
  };
}
