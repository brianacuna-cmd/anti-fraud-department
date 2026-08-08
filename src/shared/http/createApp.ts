import express, { type ErrorRequestHandler, type Express, type Router } from 'express';

export interface RouterMount {
  readonly path: string;
  readonly router: Router;
}

export interface CreateAppOptions {
  readonly routers: readonly RouterMount[];
  readonly errorHandler: ErrorRequestHandler;
  /**
   * Express `trust proxy` setting (design D-A7/§4a) — governs whether
   * `req.ip` honors `X-Forwarded-For` (proxied deployments) or reports only
   * the raw socket peer. DEFAULTS to `false` (fail-safe): without an
   * explicit hop count/boolean, `X-Forwarded-For` is a client-spoofable
   * header and MUST NOT be trusted. `main.ts` resolves this from
   * `process.env.TRUST_PROXY`; a production deployment behind a real proxy
   * MUST configure it explicitly.
   */
  readonly trustProxy?: boolean | number | string;
}

/**
 * App factory (Express App Bootstrap requirement): wires JSON body parsing,
 * mounts every module's router, and registers the error handler LAST so it
 * catches errors from all of them. `main.ts` calls this once, after Mongo is
 * connected and indexes are ensured, with an empty `routers` list until
 * Phase 2 wires `organizationRouter`.
 */
export function createApp({ routers, errorHandler, trustProxy = false }: CreateAppOptions): Express {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json());

  for (const { path, router } of routers) {
    app.use(path, router);
  }

  app.use(errorHandler);
  return app;
}
