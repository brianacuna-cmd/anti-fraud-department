import { createIngestSystemAuthContext } from '../../../../src/modules/ingest/application/createIngestSystemAuthContext.js';
import {
  createReceiveProviderWebhookUseCase,
  resolveMappedResult,
} from '../../../../src/modules/ingest/application/ReceiveProviderWebhook.js';
import { InboundWebhookSecret } from '../../../../src/modules/ingest/domain/model/aggregates/InboundWebhookSecret.js';
import { ProviderIngestEvent } from '../../../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import { generateInboundWebhookSecretId } from '../../../../src/modules/ingest/domain/model/value-objects/InboundWebhookSecretId.js';
import type { PaymentProvider } from '../../../../src/modules/ingest/domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../../../../src/modules/ingest/domain/ports/InboundWebhookSecretRepository.js';
import type { PostAckComposer } from '../../../../src/modules/ingest/domain/ports/PostAckComposer.js';
import type { ProviderEnvelopeMapper } from '../../../../src/modules/ingest/domain/ports/ProviderEnvelopeMapper.js';
import type { ProviderIngestEventRepository } from '../../../../src/modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import type { SecretCipher } from '../../../../src/modules/ingest/domain/ports/SecretCipher.js';
import type { WebhookSignatureVerifier } from '../../../../src/modules/ingest/domain/ports/WebhookSignatureVerifier.js';
import { mapProviderEnvelope } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/mapping/mapProviderEnvelope.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const STRIPE_CHARGE = {
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
    if (!ciphertext.startsWith('cipher:')) {
      return null;
    }
    return ciphertext.slice('cipher:'.length);
  }
}

class InMemorySecrets implements InboundWebhookSecretRepository {
  private readonly rows = new Map<string, InboundWebhookSecret>();

  seed(secret: InboundWebhookSecret): void {
    this.rows.set(`${secret.organizationId}:${secret.provider}`, secret);
  }

  async findByOrgProvider(
    organizationId: string,
    provider: PaymentProvider,
  ): Promise<InboundWebhookSecret | null> {
    return this.rows.get(`${organizationId}:${provider}`) ?? null;
  }

  async save(secret: InboundWebhookSecret): Promise<void> {
    this.seed(secret);
  }
}

class InMemoryEvents implements ProviderIngestEventRepository {
  readonly inserted: ProviderIngestEvent[] = [];
  nextInsert: 'inserted' | 'duplicate' | 'throw-e11000' = 'inserted';

  async insertUnique(event: ProviderIngestEvent): Promise<'inserted' | 'duplicate'> {
    if (this.nextInsert === 'throw-e11000') {
      throw { code: 11000, message: 'E11000 duplicate key error index: provider_ingest_event_org_provider_event_unique' };
    }
    if (this.nextInsert === 'duplicate') {
      return 'duplicate';
    }
    const exists = this.inserted.some(
      (row) =>
        row.organizationId === event.organizationId &&
        row.provider === event.provider &&
        row.providerEventId === event.providerEventId,
    );
    if (exists) {
      return 'duplicate';
    }
    this.inserted.push(event);
    return 'inserted';
  }

  async save(): Promise<void> {
    return undefined;
  }

  async findByOrgProviderEvent(
    organizationId: string,
    provider: PaymentProvider,
    providerEventId: string,
  ): Promise<ProviderIngestEvent | null> {
    return (
      this.inserted.find(
        (row) =>
          row.organizationId === organizationId &&
          row.provider === provider &&
          row.providerEventId === providerEventId,
      ) ?? null
    );
  }

  async findById(id: string): Promise<ProviderIngestEvent | null> {
    return this.inserted.find((row) => row.id === id) ?? null;
  }
}

function seedStripeSecret(secrets: InMemorySecrets): void {
  secrets.seed(
    InboundWebhookSecret.create({
      id: generateInboundWebhookSecretId(),
      organizationId: ORG,
      provider: 'stripe',
      ciphertext: 'cipher:whsec_live',
      now: NOW,
    }),
  );
}

function buildUseCase(overrides: {
  secrets?: InMemorySecrets;
  events?: InMemoryEvents;
  verify?: boolean;
  composer?: PostAckComposer;
  scheduled?: Array<() => void>;
  mapper?: ProviderEnvelopeMapper;
} = {}) {
  const secrets = overrides.secrets ?? new InMemorySecrets();
  if (!overrides.secrets) {
    seedStripeSecret(secrets);
  }
  const events = overrides.events ?? new InMemoryEvents();
  const composer: PostAckComposer = overrides.composer ?? {
    compose: async () => undefined,
  };
  const scheduled = overrides.scheduled ?? [];
  const verifier: WebhookSignatureVerifier = {
    verify: () => overrides.verify ?? true,
  };
  const receive = createReceiveProviderWebhookUseCase({
    secrets,
    events,
    cipher: new FakeCipher(),
    verifiers: () => verifier,
    mapper: overrides.mapper ?? { map: mapProviderEnvelope },
    composer,
    clock: new FixedClock(NOW),
    schedulePostAck: (work) => {
      scheduled.push(work);
    },
  });
  return { receive, secrets, events, scheduled, composer };
}

describe('createReceiveProviderWebhookUseCase', () => {
  it('inserts a unique RECEIVED row and ACKs PROCESSED for a first mappable MVP event (S14)', async () => {
    const { receive, events, scheduled } = buildUseCase();

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('PROCESSED');
    expect(events.inserted).toHaveLength(1);
    expect(events.inserted[0]?.status).toBe('RECEIVED');
    expect(events.inserted[0]?.providerEventId).toBe('evt_charge_succeeded');
    expect(events.inserted[0]?.organizationId).toBe(ORG);
    expect(events.inserted[0]?.provider).toBe('stripe');
    expect(scheduled).toHaveLength(1);
  });

  it('returns ACK before PostAckComposer runs (scheduled, not awaited)', async () => {
    let composeStarted = false;
    const composer: PostAckComposer = {
      compose: async () => {
        composeStarted = true;
      },
    };
    const scheduled: Array<() => void> = [];
    const { receive } = buildUseCase({ composer, scheduled });

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('PROCESSED');
    expect(composeStarted).toBe(false);
    scheduled[0]?.();
    await Promise.resolve();
    expect(composeStarted).toBe(true);
  });

  it('fails closed with WEBHOOK_SECRET_NOT_FOUND and does not persist when the secret is missing (S05)', async () => {
    const secrets = new InMemorySecrets();
    const events = new InMemoryEvents();
    const { receive, scheduled } = buildUseCase({ secrets, events });

    await expect(
      receive({
        organizationId: ORG,
        provider: 'stripe',
        rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
        headers: { 'stripe-signature': 't=1,v1=abc' },
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SECRET_NOT_FOUND' });
    expect(events.inserted).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it('fails closed with WEBHOOK_SIGNATURE_INVALID and does not persist on a bad signature (S03)', async () => {
    const events = new InMemoryEvents();
    const { receive, scheduled } = buildUseCase({ events, verify: false });

    await expect(
      receive({
        organizationId: ORG,
        provider: 'stripe',
        rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
        headers: { 'stripe-signature': 't=1,v1=bad' },
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    expect(events.inserted).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it('ACKs DUPLICATE and does not schedule composer when insertUnique reports a duplicate (S15)', async () => {
    const events = new InMemoryEvents();
    events.nextInsert = 'duplicate';
    const { receive, scheduled } = buildUseCase({ events });

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('DUPLICATE');
    expect(events.inserted).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it('ACKs DUPLICATE without composing when insertUnique throws E11000 (S15)', async () => {
    const events = new InMemoryEvents();
    events.nextInsert = 'throw-e11000';
    const { receive, scheduled } = buildUseCase({ events });

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('DUPLICATE');
    expect(scheduled).toHaveLength(0);
  });

  it('persists IGNORED and ACKs 200 without composing for an unknown MVP type (S16)', async () => {
    const { receive, events, scheduled } = buildUseCase();

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(
        JSON.stringify({
          id: 'evt_review',
          type: 'radar.review.opened',
          created: 1_704_067_200,
          data: { object: {} },
        }),
        'utf8',
      ),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('IGNORED');
    expect(events.inserted).toHaveLength(1);
    expect(events.inserted[0]?.status).toBe('IGNORED');
    expect(events.inserted[0]?.providerEventId).toBe('evt_review');
    expect(scheduled).toHaveLength(0);
  });

  it('persists FAILED and ACKs 200 without composing when customer id is missing (S19)', async () => {
    const { receive, events, scheduled } = buildUseCase();

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(
        JSON.stringify({
          id: 'evt_no_cust',
          type: 'charge.succeeded',
          created: 1_704_067_200,
          data: {
            object: {
              amount: 100,
              currency: 'usd',
              outcome: { risk_score: 1, risk_level: 'normal' },
            },
          },
        }),
        'utf8',
      ),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('FAILED');
    expect(events.inserted[0]?.status).toBe('FAILED');
    expect(events.inserted[0]?.providerEventId).toBe('evt_no_cust');
    expect(scheduled).toHaveLength(0);
  });

  it('ACKs FAILED not 4xx for a verified unparsable Bridge amount (S20)', async () => {
    const secrets = new InMemorySecrets();
    secrets.seed(
      InboundWebhookSecret.create({
        id: generateInboundWebhookSecretId(),
        organizationId: ORG,
        provider: 'bridge',
        ciphertext: 'cipher:bridge-key',
        now: NOW,
      }),
    );
    const { receive, events, scheduled } = buildUseCase({ secrets });

    const result = await receive({
      organizationId: ORG,
      provider: 'bridge',
      rawBody: Buffer.from(
        JSON.stringify({
          event_id: 'wh_bad',
          event_type: 'transfer.updated',
          event_created_at: '2026-01-01T00:00:00.000Z',
          event_object: { amount: 'abc', currency: 'usd', customer_id: 'c1' },
        }),
        'utf8',
      ),
      headers: { 'x-webhook-signature': 't=1,v0=abc' },
    });

    expect(result.status).toBe('FAILED');
    expect(events.inserted[0]?.status).toBe('FAILED');
    expect(events.inserted[0]?.providerEventId).toBe('wh_bad');
    expect(scheduled).toHaveLength(0);
  });

  it('does not require composer success to return 200 PROCESSED', async () => {
    const composer: PostAckComposer = {
      compose: async () => {
        throw new Error('SCORING_RULE_NOT_FOUND');
      },
    };
    const scheduled: Array<() => void> = [];
    const { receive } = buildUseCase({ composer, scheduled });

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('PROCESSED');
    expect(() => scheduled[0]?.()).not.toThrow();
  });

  it('keeps the ACK synchronous 2xx and routes post-ack composer failures to onPostAckError (REQ-A4)', async () => {
    const composer: PostAckComposer = {
      compose: async () => {
        throw new Error('composer exploded');
      },
    };
    const scheduled: Array<() => void> = [];
    const postAckErrors: unknown[] = [];
    const secrets = new InMemorySecrets();
    seedStripeSecret(secrets);
    const events = new InMemoryEvents();
    const verifier: WebhookSignatureVerifier = { verify: () => true };
    const receive = createReceiveProviderWebhookUseCase({
      secrets,
      events,
      cipher: new FakeCipher(),
      verifiers: () => verifier,
      mapper: { map: mapProviderEnvelope },
      composer,
      clock: new FixedClock(NOW),
      schedulePostAck: (work) => {
        scheduled.push(work);
      },
      onPostAckError: (error) => {
        postAckErrors.push(error);
      },
    });

    const result = await receive({
      organizationId: ORG,
      provider: 'stripe',
      rawBody: Buffer.from(JSON.stringify(STRIPE_CHARGE), 'utf8'),
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });

    expect(result.status).toBe('PROCESSED');
    expect(postAckErrors).toHaveLength(0);

    scheduled[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(postAckErrors).toHaveLength(1);
  });
});

describe('resolveMappedResult (REQ-E3)', () => {
  it('surfaces unparseable_body (not unparsable_amount) when the raw body fails to parse as JSON', () => {
    const result = resolveMappedResult(undefined, 'stripe', { map: mapProviderEnvelope });

    expect(result).toEqual({ status: 'failed', reason: 'unparseable_body' });
  });

  it('delegates to the mapper and preserves unparsable_amount for a genuine amount-parse failure', () => {
    const result = resolveMappedResult(
      {
        event_id: 'wh_bad',
        event_type: 'transfer.updated',
        event_created_at: '2026-01-01T00:00:00.000Z',
        event_object: { amount: 'abc', currency: 'usd', customer_id: 'c1' },
      },
      'bridge',
      { map: mapProviderEnvelope },
    );

    expect(result).toEqual({ status: 'failed', reason: 'unparsable_amount' });
  });
});

describe('createIngestSystemAuthContext', () => {
  it('builds ORGANIZATION actor system:ingest:{provider} for post-ACK compose (S21)', () => {
    const auth = createIngestSystemAuthContext(ORG, 'stripe');

    expect(auth.actorType).toBe('ORGANIZATION');
    expect(auth.userId).toBe('system:ingest:stripe');
    expect(auth.organizationId).toBe(ORG);
    expect(auth.purpose).toBe('full');
    expect(auth.roleId).toBeNull();
  });

  it('uses the provider name in userId for bridge', () => {
    const auth = createIngestSystemAuthContext(ORG, 'bridge');

    expect(auth.userId).toBe('system:ingest:bridge');
    expect(auth.actorType).toBe('ORGANIZATION');
  });
});
