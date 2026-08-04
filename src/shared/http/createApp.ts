import express, { type ErrorRequestHandler, type Express, type Router } from 'express';

export interface RouterMount {
  readonly path: string;
  readonly router: Router;
}

export interface CreateAppOptions {
  readonly routers: readonly RouterMount[];
  readonly errorHandler: ErrorRequestHandler;
}

/**
 * App factory (Express App Bootstrap requirement): wires JSON body parsing,
 * mounts every module's router, and registers the error handler LAST so it
 * catches errors from all of them. `main.ts` calls this once, after Mongo is
 * connected and indexes are ensured, with an empty `routers` list until
 * Phase 2 wires `organizationRouter`.
 */
export function createApp({ routers, errorHandler }: CreateAppOptions): Express {
  const app = express();
  app.use(express.json());

  for (const { path, router } of routers) {
    app.use(path, router);
  }

  app.use(errorHandler);
  return app;
}
