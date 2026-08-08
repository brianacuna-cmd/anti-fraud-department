import type { RequestHandler } from 'express';
import { attachAuthContext } from '../../../../../../../shared/http/requestAuthContext.js';
import type { AuthContextResolver } from './AuthContextResolver.js';

/**
 * Resolves and attaches the request's `AuthContext` via the given resolver
 * (design Data Flow: "HTTP -> authContextMiddleware -> router"). Always
 * calls `next()` on success — a request with no resolvable `AuthContext`
 * simply reaches `requireAuthContext` downstream with nothing attached.
 *
 * `resolver.resolve` is async (design D12 — a real resolver needs a
 * `Sessions` read). This handler stays async too; Express 5 natively awaits
 * and forwards a rejected async request handler's promise to the error
 * middleware, so no manual `try/catch` + `next(err)` is needed here.
 */
/**
 * `ipAddress` is populated HERE, not by each `AuthContextResolver` (design
 * D-A7/§4a) — it comes from `req.ip`, which honors Express's `trust proxy`
 * setting (`createApp`), and is identical regardless of which resolver is
 * active. `req.ip` is `undefined` when unresolvable (e.g. `trust proxy`
 * misconfigured for the deployment topology) => `null`, never a raw,
 * unvalidated header value.
 */
export function createAuthContextMiddleware(resolver: AuthContextResolver): RequestHandler {
  return async (req, _res, next) => {
    const auth = await resolver.resolve(req);
    if (auth) {
      attachAuthContext(req, { ...auth, ipAddress: req.ip ?? null });
    }
    next();
  };
}
