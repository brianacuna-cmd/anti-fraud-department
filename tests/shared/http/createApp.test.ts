import { Router } from 'express';
import request from 'supertest';
import { DomainError } from '../../../src/shared/kernel/DomainError.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { createApp } from '../../../src/shared/http/createApp.js';

class NotFoundError extends DomainError {
  constructor() {
    super('ORGANIZATION_NOT_FOUND', 'organization not found');
  }
}

function buildThingsRouter(): Router {
  const router = Router();
  router.get('/things', (_req, res) => {
    res.json({ items: ['a', 'b'] });
  });
  router.get('/things/missing', () => {
    throw new NotFoundError();
  });
  return router;
}

describe('createApp', () => {
  it('mounts a router under the given path prefix', async () => {
    const app = createApp({
      routers: [{ path: '/api/v1', router: buildThingsRouter() }],
      errorHandler: createErrorHandler({}),
    });

    const response = await request(app).get('/api/v1/things');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: ['a', 'b'] });
  });

  it('registers the error handler last so DomainErrors thrown by mounted routers are translated', async () => {
    const app = createApp({
      routers: [{ path: '/api/v1', router: buildThingsRouter() }],
      errorHandler: createErrorHandler({ ORGANIZATION_NOT_FOUND: 404 }),
    });

    const response = await request(app).get('/api/v1/things/missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'ORGANIZATION_NOT_FOUND', message: 'organization not found', metadata: {} },
    });
  });

  it('returns 404 for an unmounted path (no router claims it)', async () => {
    const app = createApp({ routers: [], errorHandler: createErrorHandler({}) });

    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
  });
});
