import type { SecretCipher } from '../../../../src/modules/ingest/domain/ports/SecretCipher.js';
import type { InboundWebhookSecretRepository } from '../../../../src/modules/ingest/domain/ports/InboundWebhookSecretRepository.js';
import type { ProviderIngestEventRepository } from '../../../../src/modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import type { WebhookSignatureVerifier } from '../../../../src/modules/ingest/domain/ports/WebhookSignatureVerifier.js';
import type { PostAckComposer } from '../../../../src/modules/ingest/domain/ports/PostAckComposer.js';
import { createIngestedPaymentEvent } from '../../../../src/modules/ingest/domain/model/IngestedPaymentEvent.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

/**
 * Documents the cloned SecretCipher contract: decrypt returns null and
 * NEVER throws (identity-access shape, ingest-owned port).
 */
class FakeSecretCipher implements SecretCipher {
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

describe('ingest domain ports', () => {
  it('SecretCipher decrypt returns plaintext for valid ciphertext and null without throwing on tamper', () => {
    const cipher: SecretCipher = new FakeSecretCipher();

    expect(cipher.encrypt('whsec_live')).toBe('cipher:whsec_live');
    expect(cipher.decrypt('cipher:whsec_live')).toBe('whsec_live');
    expect(cipher.decrypt('tampered')).toBeNull();
    expect(() => cipher.decrypt('!!!not-ciphertext!!!')).not.toThrow();
  });

  it('repository and verifier ports are callable by ingest application shape', async () => {
    const secrets: InboundWebhookSecretRepository = {
      findByOrgProvider: async () => null,
      save: async () => undefined,
    };
    const events: ProviderIngestEventRepository = {
      insertUnique: async () => 'inserted',
      save: async () => undefined,
      findByOrgProviderEvent: async () => null,
    };
    const verifier: WebhookSignatureVerifier = {
      verify: () => true,
    };
    const composer: PostAckComposer = {
      compose: async () => undefined,
    };

    await expect(secrets.findByOrgProvider('org-1', 'stripe')).resolves.toBeNull();
    await expect(events.findByOrgProviderEvent('org-1', 'stripe', 'evt_1')).resolves.toBeNull();
    expect(
      verifier.verify(Buffer.from('{}'), { 'stripe-signature': 't=1,v1=abc' }, 'whsec'),
    ).toBe(true);

    const event = createIngestedPaymentEvent({
      provider: 'stripe',
      providerEventType: 'charge.succeeded',
      caseCustomerId: 'cust-1',
      amountCents: 100,
      currency: 'USD',
      riskSignals: {},
      createdAt: fromDate(new Date('2026-01-01T00:00:00.000Z')),
    });
    await expect(
      composer.compose({
        organizationId: 'org-1',
        provider: 'stripe',
        event,
        ingestEventId: 'ing-1',
      }),
    ).resolves.toBeUndefined();
  });
});
