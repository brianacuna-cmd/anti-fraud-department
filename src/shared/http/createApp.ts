import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
  type Router,
} from 'express';

export interface RouterMount {
  readonly path: string;
  readonly router: Router;
}

export interface CreateAppOptions {
  readonly routers: readonly RouterMount[];
  /**
   * Provider webhook mounts (design D1/A2). Applied before express.json()
   * with a raw-body parser for every content type so HMAC/PKI verification
   * sees the exact request bytes on `req.body`. These routers MUST NOT run
   * JWT authContextMiddleware — callers pass a separate router from `routers`.
   */
  readonly webhookRouters?: readonly RouterMount[];
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

function mountRouters(app: Express, mounts: readonly RouterMount[], middleware: RequestHandler[] = []): void {
  for (const { path, router } of mounts) {
    app.use(path, ...middleware, router);
  }
}

/**
 * App factory (Express App Bootstrap requirement): optional raw-body webhook
 * mounts, then JSON body parsing for `/api/v1`, then module routers, then the
 * error handler LAST so it catches errors from all of them.
 */
export function createApp({
  routers,
  webhookRouters = [],
  errorHandler,
  trustProxy = false,
}: CreateAppOptions): Express {
  const app = express();
  app.set('trust proxy', trustProxy);

  mountRouters(app, webhookRouters, [express.raw({ type: '*/*' })]);
  app.use(express.json());
  mountRouters(app, routers);

  app.use(errorHandler);
  return app;
}
