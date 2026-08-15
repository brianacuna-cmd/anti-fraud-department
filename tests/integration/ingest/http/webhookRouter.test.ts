import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createReceiveProviderWebhookUseCase } from '../../../../src/modules/ingest/application/ReceiveProviderWebhook.js';
import { InboundWebhookSecret } from '../../../../src/modules/ingest/domain/model/aggregates/InboundWebhookSecret.js';
import { ProviderIngestEvent } from '../../../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import { generateInboundWebhookSecretId } from '../../../../src/modules/ingest/domain/model/value-objects/InboundWebhookSecretId.js';
import type { PaymentProvider } from '../../../../src/modules/ingest/domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../../../../src/modules/ingest/domain/ports/InboundWebhookSecretRepository.js';
import type { PostAckComposer } from '../../../../src/modules/ingest/domain/ports/PostAckComposer.js';
import type { ProviderIngestEventRepository } from '../../../../src/modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import type { SecretCipher } from '../../../../src/modules/ingest/domain/ports/SecretCipher.js';
import { ingestErrorStatus } from '../../../../src/modules/ingest/infrastructure/adapters/inbound/http/errorStatus.js';
import { webhookRouter } from '../../../../src/modules/ingest/infrastructure/adapters/inbound/http/webhookRouter.js';
import { selectVerifier } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/crypto/selectVerifier.js';
import { mapProviderEnvelope } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/mapping/mapProviderEnvelope.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_A = oid('org-a');
const ORG_B = oid('org-b');
const STRIPE_SECRET = 'whsec_org_a';
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
  readonly lookups: Array<{ organizationId: string; provider: PaymentProvider }> = [];
  private readonly rows = new Map<string, InboundWebhookSecret>();

  seed(secret: InboundWebhookSecret): void {
    this.rows.set(`${secret.organizationId}:${secret.provider}`, secret);
  }

  async findByOrgProvider(
    organizationId: string,
    provider: PaymentProvider,
  ): Promise<InboundWebhookSecret | null> {
    this.lookups.push({ organizationId, provider });
    return this.rows.get(`${organizationId}:${provider}`) ?? null;
  }

  async save(secret: InboundWebhookSecret): Promise<void> {
    this.seed(secret);
  }
}

class InMemoryEvents implements ProviderIngestEventRepository {
  readonly rows: ProviderIngestEvent[] = [];

  async insertUnique(event: ProviderIngestEvent): Promise<'inserted' | 'duplicate'> {
    const exists = this.rows.some(
      (row) =>
        row.organizationId === event.organizationId &&
        row.provider === event.provider &&
        row.providerEventId === event.providerEventId,
    );
    if (exists) {
      return 'duplicate';
    }
    this.rows.push(event);
    return 'inserted';
  }

  async save(event: ProviderIngestEvent): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === event.id);
    if (index >= 0) {
      this.rows[index] = event;
      return;
    }
    this.rows.push(event);
  }

  async findByOrgProviderEvent(
    organizationId: string,
    provider: PaymentProvider,
    providerEventId: string,
  ): Promise<ProviderIngestEvent | null> {
    return (
      this.rows.find(
        (row) =>
          row.organizationId === organizationId &&
          row.provider === provider &&
          row.providerEventId === providerEventId,
      ) ?? null
    );
  }
}

class RecordingComposer implements PostAckComposer {
  readonly calls: Array<{
    organizationId: string;
    provider: string;
    ingestEventId: string;
    stripeRiskScore: unknown;
  }> = [];
  hangForever = false;
  fail: Error | null = null;

  async compose(input: {
    organizationId: string;
    provider: string;
    event: { riskSignals: Readonly<Record<string, unknown>> };
    ingestEventId: string;
  }): Promise<void> {
    this.calls.push({
      organizationId: input.organizationId,
      provider: input.provider,
      ingestEventId: input.ingestEventId,
      stripeRiskScore: input.event.riskSignals.stripeRiskScore,
    });
    if (this.fail) {
      throw this.fail;
    }
    if (this.hangForever) {
      await new Promise<void>(() => undefined);
    }
  }
}

function stripeSignature(secret: string, rawBody: Buffer): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function seedStripeSecret(secrets: InMemorySecrets, organizationId = ORG_A, plaintext = STRIPE_SECRET): void {
  secrets.seed(
    InboundWebhookSecret.create({
      id: generateInboundWebhookSecretId(),
      organizationId,
      provider: 'stripe',
      ciphertext: `cipher:${plaintext}`,
      now: NOW,
    }),
  );
}

function buildApp(options: { secrets: InMemorySecrets; events: InMemoryEvents; composer: RecordingComposer }) {
  const receiveProviderWebhook = createReceiveProviderWebhookUseCase({
    secrets: options.secrets,
    events: options.events,
    cipher: new FakeCipher(),
    verifiers: selectVerifier,
    mapper: { map: mapProviderEnvelope },
    composer: options.composer,
    clock: new FixedClock(NOW),
  });
  return createApp({
    routers: [],
    webhookRouters: [{ path: '/webhooks', router: webhookRouter({ receiveProviderWebhook }) }],
    errorHandler: createErrorHandler(ingestErrorStatus),
  });
}

describe('webhookRouter', () => {
  it('loads the inbound secret for (org A, stripe) without requiring JWT (S01)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const composer = new RecordingComposer();
    seedStripeSecret(secrets);
    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');
    const app = buildApp({ secrets, events, composer });

    const response = await request(app)
      .post(`/webhooks/stripe/${ORG_A}`)
      .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'PROCESSED' });
    expect(secrets.lookups).toEqual([{ organizationId: ORG_A, provider: 'stripe' }]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.organizationId).toBe(ORG_A);
  });

  it('returns 401 WEBHOOK_SECRET_NOT_FOUND and does not persist when the org has no secret (S05)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const composer = new RecordingComposer();
    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');
    const app = buildApp({ secrets, events, composer });

    const response = await request(app)
      .post(`/webhooks/stripe/${ORG_A}`)
      .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('WEBHOOK_SECRET_NOT_FOUND');
    expect(events.rows).toHaveLength(0);
    expect(composer.calls).toHaveLength(0);
  });

  it('returns 401 WEBHOOK_SIGNATURE_INVALID for a wrong-org path, bad signature, or missing signature (S02–S04)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const composer = new RecordingComposer();
    seedStripeSecret(secrets, ORG_A, STRIPE_SECRET);
    seedStripeSecret(secrets, ORG_B, 'whsec_org_b');
    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');
    const app = buildApp({ secrets, events, composer });

    const wrongOrg = await request(app)
      .post(`/webhooks/stripe/${ORG_B}`)
      .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));
    const badSig = await request(app)
      .post(`/webhooks/stripe/${ORG_A}`)
      .set('Stripe-Signature', stripeSignature('whsec_other', raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));
    const missingSig = await request(app)
      .post(`/webhooks/stripe/${ORG_A}`)
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(wrongOrg.status).toBe(401);
    expect(wrongOrg.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(badSig.status).toBe(401);
    expect(badSig.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(missingSig.status).toBe(401);
    expect(missingSig.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(events.rows).toHaveLength(0);
    expect(composer.calls).toHaveLength(0);
  });

  it('returns HTTP 200 { status } before post-ACK composition completes (S17)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const composer = new RecordingComposer();
    composer.hangForever = true;
    seedStripeSecret(secrets);
    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');
    const app = buildApp({ secrets, events, composer });

    const response = await request(app)
      .post(`/webhooks/stripe/${ORG_A}`)
      .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'PROCESSED' });
  });

  it('keeps HTTP 200 when post-ACK scoring throws (S18)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const composer = new RecordingComposer();
    composer.fail = Object.assign(new Error('SCORING_RULE_NOT_FOUND'), { code: 'SCORING_RULE_NOT_FOUND' });
    seedStripeSecret(secrets);
    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');
    const app = buildApp({ secrets, events, composer });

    const response = await request(app)
      .post(`/webhooks/stripe/${ORG_A}`)
      .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'PROCESSED' });
  });

  it('ACKs a duplicate delivery as DUPLICATE without composing (S15)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const composer = new RecordingComposer();
    seedStripeSecret(secrets);
    const raw = Buffer.from(JSON.stringify(CHARGE), 'utf8');
    const app = buildApp({ secrets, events, composer });
    const post = () =>
      request(app)
        .post(`/webhooks/stripe/${ORG_A}`)
        .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
        .set('Content-Type', 'application/json')
        .send(raw.toString('utf8'));

    const first = await post();
    const second = await post();

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: 'PROCESSED' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: 'DUPLICATE' });
    expect(events.rows).toHaveLength(1);
  });

  it('ACKs unknown MVP types as IGNORED without composing (S16)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const composer = new RecordingComposer();
    seedStripeSecret(secrets);
    const payload = { id: 'evt_review', type: 'radar.review.opened', data: { object: {} } };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const app = buildApp({ secrets, events, composer });

    const response = await request(app)
      .post(`/webhooks/stripe/${ORG_A}`)
      .set('Stripe-Signature', stripeSignature(STRIPE_SECRET, raw))
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'IGNORED' });
    expect(composer.calls).toHaveLength(0);
  });
});
