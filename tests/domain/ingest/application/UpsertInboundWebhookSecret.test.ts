import { createUpsertInboundWebhookSecretUseCase } from '../../../../src/modules/ingest/application/UpsertInboundWebhookSecret.js';
import { InboundWebhookSecret } from '../../../../src/modules/ingest/domain/model/aggregates/InboundWebhookSecret.js';
import { IngestError } from '../../../../src/modules/ingest/domain/errors/IngestError.js';
import { generateInboundWebhookSecretId } from '../../../../src/modules/ingest/domain/model/value-objects/InboundWebhookSecretId.js';
import type { PaymentProvider } from '../../../../src/modules/ingest/domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../../../../src/modules/ingest/domain/ports/InboundWebhookSecretRepository.js';
import type { SecretCipher } from '../../../../src/modules/ingest/domain/ports/SecretCipher.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-a');
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
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

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
  saveCalls = 0;

  async findByOrgProvider(
    organizationId: string,
    provider: PaymentProvider,
  ): Promise<InboundWebhookSecret | null> {
    return this.rows.get(`${organizationId}:${provider}`) ?? null;
  }

  async save(secret: InboundWebhookSecret): Promise<void> {
    this.saveCalls += 1;
    this.rows.set(`${secret.organizationId}:${secret.provider}`, secret);
  }
}

function buildUseCase(secrets: InMemorySecrets, now = NOW) {
  return createUpsertInboundWebhookSecretUseCase({
    secrets,
    cipher: new FakeCipher(),
    clock: new FixedClock(now),
    generateInboundWebhookSecretId,
  });
}

describe('createUpsertInboundWebhookSecretUseCase', () => {
  it('stores ciphertext only for SUPERVISOR stripe upsert and decrypts back to the plaintext (S22)', async () => {
    const secrets = new InMemorySecrets();
    const upsert = buildUseCase(secrets);

    const result = await upsert({ auth: SUPERVISOR, provider: 'stripe', secret: 'whsec_org_a' });

    const stored = await secrets.findByOrgProvider(ORG, 'stripe');
    expect(stored).not.toBeNull();
    expect(stored!.ciphertext).toBe('cipher:whsec_org_a');
    expect(stored!.ciphertext).not.toBe('whsec_org_a');
    expect(new FakeCipher().decrypt(stored!.ciphertext)).toBe('whsec_org_a');
    expect(result.provider).toBe('stripe');
    expect(result.updatedAt).toBe(NOW);
    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('ciphertext');
  });

  it('re-upsert replaces the previous coinflow ciphertext for the same org (S23)', async () => {
    const secrets = new InMemorySecrets();
    const first = buildUseCase(secrets, NOW);
    await first({ auth: SUPERVISOR, provider: 'coinflow', secret: 'validation-key-old' });
    const original = await secrets.findByOrgProvider(ORG, 'coinflow');

    const upsert = buildUseCase(secrets, LATER);
    const result = await upsert({ auth: SUPERVISOR, provider: 'coinflow', secret: 'validation-key-new' });

    const stored = await secrets.findByOrgProvider(ORG, 'coinflow');
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe(original!.id);
    expect(stored!.ciphertext).toBe('cipher:validation-key-new');
    expect(stored!.ciphertext).not.toBe('cipher:validation-key-old');
    expect(new FakeCipher().decrypt(stored!.ciphertext)).toBe('validation-key-new');
    expect(stored!.createdAt).toBe(NOW);
    expect(stored!.updatedAt).toBe(LATER);
    expect(result).toEqual({ provider: 'coinflow', updatedAt: LATER });
    expect(secrets.rows.size).toBe(1);
  });

  /**
   * ADMIN incluido: rotar el secreto de un webhook cambia quien puede meter
   * casos en el sistema. Es operacion, no gobierno (SoD, ver
   * `shared/kernel/AccessTier.ts`).
   */
  it.each([
    ['AUDITOR', () => AUDITOR],
    ['ADMIN', () => ADMIN],
  ])('rejects %s upsert with FORBIDDEN_ROLE and does not create or change a row (S24)', async (_role, actor) => {
    const secrets = new InMemorySecrets();
    const upsert = buildUseCase(secrets);
    const readOnly = actor();

    await expect(upsert({ auth: readOnly, provider: 'stripe', secret: 'whsec_auditor' })).rejects.toMatchObject({
      constructor: IngestError,
      code: 'FORBIDDEN_ROLE',
    });
    expect(secrets.saveCalls).toBe(0);
    expect(secrets.rows.size).toBe(0);

    await buildUseCase(secrets)({ auth: SUPERVISOR, provider: 'stripe', secret: 'whsec_keep' });
    const before = await secrets.findByOrgProvider(ORG, 'stripe');

    await expect(upsert({ auth: readOnly, provider: 'stripe', secret: 'whsec_overwrite' })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    const after = await secrets.findByOrgProvider(ORG, 'stripe');
    expect(after!.ciphertext).toBe(before!.ciphertext);
    expect(secrets.saveCalls).toBe(1);
  });
});
