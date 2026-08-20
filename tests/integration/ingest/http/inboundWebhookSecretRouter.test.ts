import { createHmac } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { createReceiveProviderWebhookUseCase } from '../../../../src/modules/ingest/application/ReceiveProviderWebhook.js';
import { createUpsertInboundWebhookSecretUseCase } from '../../../../src/modules/ingest/application/UpsertInboundWebhookSecret.js';
import { InboundWebhookSecret } from '../../../../src/modules/ingest/domain/model/aggregates/InboundWebhookSecret.js';
import { ProviderIngestEvent } from '../../../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import { generateInboundWebhookSecretId } from '../../../../src/modules/ingest/domain/model/value-objects/InboundWebhookSecretId.js';
import type { PaymentProvider } from '../../../../src/modules/ingest/domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../../../../src/modules/ingest/domain/ports/InboundWebhookSecretRepository.js';
import type { PostAckComposer } from '../../../../src/modules/ingest/domain/ports/PostAckComposer.js';
import type { ProviderIngestEventRepository } from '../../../../src/modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import type { SecretCipher } from '../../../../src/modules/ingest/domain/ports/SecretCipher.js';
import { ingestErrorStatus } from '../../../../src/modules/ingest/infrastructure/adapters/inbound/http/errorStatus.js';
import { inboundWebhookSecretRouter } from '../../../../src/modules/ingest/infrastructure/adapters/inbound/http/inboundWebhookSecretRouter.js';
import { webhookRouter } from '../../../../src/modules/ingest/infrastructure/adapters/inbound/http/webhookRouter.js';
import { selectVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/selectVerifier.js';
import { mapProviderEnvelope } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/mapping/mapProviderEnvelope.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-a');
const STRIPE_SECRET = 'whsec_org_a';
const SUPERVISOR = createAuthContext({
  userId: oid('user-supervisor'),
  organizationId: ORG,
  roleId: 'SUPERVISOR',
});
const ADMIN = createAuthContext({
  userId: oid('user-admin'),
  organizationId: ORG,
  roleId: 'ADMIN',
});
const AUDITOR = createAuthContext({
  userId: oid('user-auditor'),
  organizationId: ORG,
  roleId: 'AUDITOR',
});
const CHARGE = {
  id: 'evt_charge_succeeded',
  object: 'event',
  type: 'charge.succeeded',
  created: 1_704_067_200,
  data: {
    object: {
      id: 'ch_1',
      object: 'charge',
      amount: 2500,
      currency: 'usd',
      customer: 'cus_1',
      outcome: { risk_score: 68, risk_level: 'elevated' },
    },
  },
};

class FakeCipher implements SecretCipher {
  encrypt(plaintext: string): string {
    return `cipher:${plaintext}`;
  }

  decrypt(ciphertext: string): string | null {
    return ciphertext.startsWith('cipher:') ? ciphertext.slice('cipher:'.length) : null;
  }
}

class InMemorySecrets implements InboundWebhookSecretRepository {
  readonly rows = new Map<string, InboundWebhookSecret>();

  async findByOrgProvider(
    organizationId: string,
    provider: PaymentProvider,
  ): Promise<InboundWebhookSecret | null> {
    return this.rows.get(`${organizationId}:${provider}`) ?? null;
  }

  async save(secret: InboundWebhookSecret): Promise<void> {
    this.rows.set(`${secret.organizationId}:${secret.provider}`, secret);
  }
}

class InMemoryEvents implements ProviderIngestEventRepository {
  readonly rows: ProviderIngestEvent[] = [];

  async insertUnique(event: ProviderIngestEvent): Promise<'inserted' | 'duplicate'> {
    this.rows.push(event);
    return 'inserted';
  }

  async save(event: ProviderIngestEvent): Promise<void> {
    this.rows.push(event);
  }

  async findByOrgProviderEvent(): Promise<ProviderIngestEvent | null> {
    return null;
  }

  async findById(): Promise<ProviderIngestEvent | null> {
    return null;
  }
}

class NoopComposer implements PostAckComposer {
  async compose(): Promise<void> {
    return undefined;
  }
}

function stripeSignature(secret: string, rawBody: Buffer): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function buildApp(actor: AuthContext = SUPERVISOR) {
  const secrets = new InMemorySecrets();
  const events = new InMemoryEvents();
  const cipher = new FakeCipher();
  const clock = new FixedClock(NOW);
  const upsertInboundWebhookSecret = createUpsertInboundWebhookSecretUseCase({
    secrets,
    cipher,
    clock,
    generateInboundWebhookSecretId,
  });
  const receiveProviderWebhook = createReceiveProviderWebhookUseCase({
    secrets,
    events,
    cipher,
    verifiers: selectVerifier,
    mapper: { map: mapProviderEnvelope },
    composer: new NoopComposer(),
    clock,
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actor);
    next();
  }

  const api = Router();
  api.use(testAuthMiddleware);
  api.use(inboundWebhookSecretRouter({ upsertInboundWebhookSecret }));

  const app = createApp({
    routers: [{ path: '/api/v1', router: api }],
    webhookRouters: [{ path: '/webhooks', router: webhookRouter({ receiveProviderWebhook }) }],
    errorHandler: createErrorHandler(ingestErrorStatus),
  });

  return { app, secrets, events };
}

describe('inboundWebhookSecretRouter', () => {
  it('SUPERVISOR PUT stores ciphertext and a later signed webhook verifies (S22)', async () => {
    const { app, secrets } = buildApp(SUPERVISOR);

    const put = await request(app)
      .put('/api/v1/inbound-webhook-secrets')
      .send({ provider: 'stripe', secret: STRIPE_SECRET });

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ provider: 'stripe', updatedAt: NOW });
    const stored = await secrets.findByOrgProvider(ORG, 'stripe');
    expect(stored!.ciphertext).toBe(`cipher:${STRIPE_SECRET}`);
    expect(stored!.ciphertext).not.toBe(STRIPE_SECRET);

    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');
    const webhook = await request(app)
      .post(`/webhooks/stripe/${ORG}`)
      .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(webhook.status).toBe(200);
    expect(webhook.body).toEqual({ status: 'PROCESSED' });
  });

  it('ADMIN PUT replaces coinflow ciphertext and returns only provider and updatedAt (S23)', async () => {
    const { app, secrets } = buildApp(ADMIN);

    const first = await request(app)
      .put('/api/v1/inbound-webhook-secrets')
      .send({ provider: 'coinflow', secret: 'validation-key-old' });
    const second = await request(app)
      .put('/api/v1/inbound-webhook-secrets')
      .send({ provider: 'coinflow', secret: 'validation-key-new' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Object.keys(second.body).sort()).toEqual(['provider', 'updatedAt']);
    expect(second.body).toEqual({ provider: 'coinflow', updatedAt: NOW });
    expect(JSON.stringify(second.body)).not.toContain('validation-key');
    expect(JSON.stringify(second.body)).not.toContain('cipher:');
    expect((await secrets.findByOrgProvider(ORG, 'coinflow'))!.ciphertext).toBe('cipher:validation-key-new');
  });

  it('rejects unknown body fields with 400 INVARIANT_VIOLATION', async () => {
    const { app, secrets } = buildApp(SUPERVISOR);

    const put = await request(app)
      .put('/api/v1/inbound-webhook-secrets')
      .send({ provider: 'stripe', secret: STRIPE_SECRET, extra: 'nope' });

    expect(put.status).toBe(400);
    expect(put.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(secrets.rows.size).toBe(0);
  });

  it('AUDITOR PUT is 403 FORBIDDEN_ROLE and creates no row (S24)', async () => {
    const { app, secrets } = buildApp(AUDITOR);

    const put = await request(app)
      .put('/api/v1/inbound-webhook-secrets')
      .send({ provider: 'stripe', secret: STRIPE_SECRET });

    expect(put.status).toBe(403);
    expect(put.body.error.code).toBe('FORBIDDEN_ROLE');
    expect(secrets.rows.size).toBe(0);
  });

  it('omits GET so no read returns plaintext or ciphertext (S26)', async () => {
    const { app, secrets } = buildApp(SUPERVISOR);
    await request(app)
      .put('/api/v1/inbound-webhook-secrets')
      .send({ provider: 'stripe', secret: STRIPE_SECRET });

    const collectionGet = await request(app).get('/api/v1/inbound-webhook-secrets');
    const itemGet = await request(app).get('/api/v1/inbound-webhook-secrets/stripe');

    expect(collectionGet.status).toBe(404);
    expect(itemGet.status).toBe(404);
    expect(JSON.stringify(collectionGet.body)).not.toContain(STRIPE_SECRET);
    expect(JSON.stringify(itemGet.body)).not.toContain('cipher:');
    expect((await secrets.findByOrgProvider(ORG, 'stripe'))!.ciphertext).toBe(`cipher:${STRIPE_SECRET}`);
  });

  it('returns 4xx when a webhook arrives with no upserted secret (S05, S25)', async () => {
    const { app, events } = buildApp(SUPERVISOR);
    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');

    const webhook = await request(app)
      .post(`/webhooks/bridge/${ORG}`)
      .set('X-Webhook-Signature', 't=1,v0=deadbeef')
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(webhook.status).toBe(401);
    expect(webhook.body.error.code).toBe('WEBHOOK_SECRET_NOT_FOUND');
    expect(events.rows).toHaveLength(0);
  });
});
