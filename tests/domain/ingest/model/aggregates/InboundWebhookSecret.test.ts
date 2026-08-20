import { InboundWebhookSecret } from '../../../../../src/modules/ingest/domain/model/aggregates/InboundWebhookSecret.js';
import { generateInboundWebhookSecretId } from '../../../../../src/modules/ingest/domain/model/value-objects/InboundWebhookSecretId.js';
import { IngestError } from '../../../../../src/modules/ingest/domain/errors/IngestError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { oid } from '../../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function create(overrides: Partial<Parameters<typeof InboundWebhookSecret.create>[0]> = {}): InboundWebhookSecret {
  return InboundWebhookSecret.create({
    id: generateInboundWebhookSecretId(),
    organizationId: oid('org-1'),
    provider: 'stripe',
    ciphertext: 'aes-gcm:ciphertext-not-plaintext',
    now: NOW,
    ...overrides,
  });
}

describe('InboundWebhookSecret', () => {
  it('stores organization, provider, and ciphertext only (no plaintext)', () => {
    const secret = create();

    expect(secret.organizationId).toBe(oid('org-1'));
    expect(secret.provider).toBe('stripe');
    expect(secret.ciphertext).toBe('aes-gcm:ciphertext-not-plaintext');
    expect(secret.createdAt).toBe(NOW);
    expect(secret.updatedAt).toBe(NOW);
    expect(secret).not.toHaveProperty('plaintext');
    expect(secret).not.toHaveProperty('secret');
  });

  it('replaceCiphertext updates ciphertext and updatedAt without exposing plaintext', () => {
    const secret = create({ provider: 'coinflow' });

    const replaced = secret.replaceCiphertext('aes-gcm:new-ciphertext', LATER);

    expect(replaced.provider).toBe('coinflow');
    expect(replaced.ciphertext).toBe('aes-gcm:new-ciphertext');
    expect(replaced.updatedAt).toBe(LATER);
    expect(replaced.createdAt).toBe(NOW);
    expect(secret.ciphertext).toBe('aes-gcm:ciphertext-not-plaintext');
  });

  it('rejects an empty organizationId', () => {
    expect(() => create({ organizationId: '  ' })).toThrow(IngestError);
  });

  it('rejects an empty ciphertext', () => {
    expect(() => create({ ciphertext: '' })).toThrow(IngestError);
  });

  it('rejects an unknown provider', () => {
    expect(() => create({ provider: 'paypal' as 'stripe' })).toThrow(IngestError);
  });

  it('accepts bridge and coinflow providers', () => {
    expect(create({ provider: 'bridge' }).provider).toBe('bridge');
    expect(create({ provider: 'coinflow' }).provider).toBe('coinflow');
  });

  it('rehydrates persisted props without re-validating', () => {
    const created = create({ provider: 'bridge' });
    const rehydrated = InboundWebhookSecret.rehydrate(created.toProps());

    expect(rehydrated.id).toBe(created.id);
    expect(rehydrated.provider).toBe('bridge');
    expect(rehydrated.ciphertext).toBe(created.ciphertext);
  });
});
