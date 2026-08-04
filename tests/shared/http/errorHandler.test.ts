import express from 'express';
import request from 'supertest';
import { DomainError } from '../../../src/shared/kernel/DomainError.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';

class SlugTakenError extends DomainError {
  constructor() {
    super('ORGANIZATION_SLUG_TAKEN', 'slug "acme" is already in use', { slug: 'acme' });
  }
}

function buildApp(statusByCode: Record<string, number>): express.Express {
  const app = express();
  app.get('/domain-error', () => {
    throw new SlugTakenError();
  });
  app.get('/unexpected-error', () => {
    throw new Error('a raw driver failure with sensitive details');
  });
  app.use(createErrorHandler(statusByCode));
  return app;
}

describe('createErrorHandler', () => {
  it('serializes a DomainError as {error:{code,message,metadata}} with the mapped status', async () => {
    const app = buildApp({ ORGANIZATION_SLUG_TAKEN: 409 });

    const response = await request(app).get('/domain-error');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: 'ORGANIZATION_SLUG_TAKEN',
        message: 'slug "acme" is already in use',
        metadata: { slug: 'acme' },
      },
    });
  });

  it('maps a non-domain error to 500 INTERNAL without leaking its message', async () => {
    const app = buildApp({ ORGANIZATION_SLUG_TAKEN: 409 });

    const response = await request(app).get('/unexpected-error');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(response.body)).not.toContain('sensitive details');
  });

  it('falls back to 500 for a DomainError code missing from the status map', async () => {
    const app = buildApp({});

    const response = await request(app).get('/domain-error');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('ORGANIZATION_SLUG_TAKEN');
  });
});
