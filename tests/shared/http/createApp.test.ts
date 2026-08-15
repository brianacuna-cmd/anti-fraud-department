import { Router, type Request, type Response, type NextFunction } from 'express';
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

  it('defaults trust proxy to false (fail-safe: req.ip ignores X-Forwarded-For)', async () => {
    const router = Router();
    router.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const app = createApp({ routers: [{ path: '/', router }], errorHandler: createErrorHandler({}) });

    const response = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.9');

    expect(response.body.ip).not.toBe('203.0.113.9');
  });

  it('honors X-Forwarded-For for req.ip when trustProxy is configured (design D-A7)', async () => {
    const router = Router();
    router.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const app = createApp({
      routers: [{ path: '/', router }],
      errorHandler: createErrorHandler({}),
      trustProxy: true,
    });

    const response = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.9');

    expect(response.body.ip).toBe('203.0.113.9');
  });

  it('exposes the exact raw Buffer on webhook mounts so HMAC can verify the posted bytes', async () => {
    const webhookRouter = Router();
    webhookRouter.post('/stripe/:organizationId', (req, res) => {
      const body = req.body as unknown;
      res.json({
        isBuffer: Buffer.isBuffer(body),
        hex: Buffer.isBuffer(body) ? body.toString('hex') : null,
      });
    });
    const app = createApp({
      routers: [],
      webhookRouters: [{ path: '/webhooks', router: webhookRouter }],
      errorHandler: createErrorHandler({}),
    });
    const raw = '{"id":"evt_1","type":"charge.succeeded"}';

    const response = await request(app)
      .post('/webhooks/stripe/org-a')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(response.status).toBe(200);
    expect(response.body.isBuffer).toBe(true);
    expect(response.body.hex).toBe(Buffer.from(raw, 'utf8').toString('hex'));
  });

  it('keeps /api/v1 JSON parsing when a webhook mount is also registered', async () => {
    const webhookRouter = Router();
    webhookRouter.post('/probe', (req, res) => {
      res.json({ webhookIsBuffer: Buffer.isBuffer(req.body) });
    });
    const apiRouter = Router();
    apiRouter.post('/echo', (req, res) => {
      res.json({ parsed: req.body });
    });
    const app = createApp({
      routers: [{ path: '/api/v1', router: apiRouter }],
      webhookRouters: [{ path: '/webhooks', router: webhookRouter }],
      errorHandler: createErrorHandler({}),
    });

    const apiResponse = await request(app).post('/api/v1/echo').send({ amountCents: 1500 });
    const webhookResponse = await request(app)
      .post('/webhooks/probe')
      .set('Content-Type', 'application/json')
      .send('{"probe":true}');

    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body.parsed).toEqual({ amountCents: 1500 });
    expect(webhookResponse.status).toBe(200);
    expect(webhookResponse.body.webhookIsBuffer).toBe(true);
  });

  it('does not run JWT auth middleware on webhook mounts and does not treat Coinflow Authorization as Bearer', async () => {
    const requireBearer: (req: Request, res: Response, next: NextFunction) => void = (req, res, next) => {
      const authorization = req.header('authorization');
      if (authorization === undefined || !authorization.startsWith('Bearer ')) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'missing bearer' } });
        return;
      }
      next();
    };
    const apiRouter = Router();
    apiRouter.use(requireBearer);
    apiRouter.post('/secure', (req, res) => {
      res.json({ parsed: req.body, jwt: true });
    });
    const webhookRouter = Router();
    webhookRouter.post('/coinflow/:organizationId', (req, res) => {
      res.json({
        isBuffer: Buffer.isBuffer(req.body),
        authorization: req.header('authorization'),
      });
    });
    const app = createApp({
      routers: [{ path: '/api/v1', router: apiRouter }],
      webhookRouters: [{ path: '/webhooks', router: webhookRouter }],
      errorHandler: createErrorHandler({}),
    });
    const validationKey = 'coinflow-validation-key-not-jwt';

    const webhookResponse = await request(app)
      .post('/webhooks/coinflow/org-a')
      .set('Authorization', validationKey)
      .set('Content-Type', 'application/json')
      .send('{"eventType":"Card Payment Authorized"}');
    const unauthenticatedApi = await request(app).post('/api/v1/secure').send({ keep: 'json' });
    const authenticatedApi = await request(app)
      .post('/api/v1/secure')
      .set('Authorization', 'Bearer session-token')
      .send({ keep: 'json' });

    expect(webhookResponse.status).toBe(200);
    expect(webhookResponse.body.isBuffer).toBe(true);
    expect(webhookResponse.body.authorization).toBe(validationKey);
    expect(unauthenticatedApi.status).toBe(401);
    expect(unauthenticatedApi.body.error.code).toBe('UNAUTHENTICATED');
    expect(authenticatedApi.status).toBe(200);
    expect(authenticatedApi.body).toEqual({ parsed: { keep: 'json' }, jwt: true });
  });

  it('mounts webhook routers on a configured path other than /webhooks', async () => {
    const webhookRouter = Router();
    webhookRouter.post('/hook', (req, res) => {
      res.json({
        isBuffer: Buffer.isBuffer(req.body),
        utf8: Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null,
      });
    });
    const app = createApp({
      routers: [],
      webhookRouters: [{ path: '/inbound', router: webhookRouter }],
      errorHandler: createErrorHandler({}),
    });
    const raw = '{"spaced": true}';

    const response = await request(app)
      .post('/inbound/hook')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(response.status).toBe(200);
    expect(response.body.isBuffer).toBe(true);
    expect(response.body.utf8).toBe(raw);
  });
});
