import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import { InboundWebhookSecret } from '../domain/model/aggregates/InboundWebhookSecret.js';
import type { InboundWebhookSecretId } from '../domain/model/value-objects/InboundWebhookSecretId.js';
import { createPaymentProvider, type PaymentProvider } from '../domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../domain/ports/InboundWebhookSecretRepository.js';
import type { SecretCipher } from '../domain/ports/SecretCipher.js';
import { requireRole } from './authorization/requireRole.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

const SECRET_WRITE_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface UpsertInboundWebhookSecretInput {
  readonly auth: AuthContext;
  readonly provider: string;
  readonly secret: string;
}

export interface UpsertInboundWebhookSecretResult {
  readonly provider: PaymentProvider;
  readonly updatedAt: Instant;
}

export interface UpsertInboundWebhookSecretDeps {
  readonly secrets: InboundWebhookSecretRepository;
  readonly cipher: SecretCipher;
  readonly clock: Clock;
  readonly generateInboundWebhookSecretId: () => InboundWebhookSecretId;
}

/**
 * JWT SUPERVISOR|ADMIN upsert of one inbound secret per (org, provider).
 * Encrypts plaintext before persist; never returns ciphertext or secret.
 */
export function createUpsertInboundWebhookSecretUseCase(deps: UpsertInboundWebhookSecretDeps) {
  return async function upsertInboundWebhookSecret(
    input: UpsertInboundWebhookSecretInput,
  ): Promise<UpsertInboundWebhookSecretResult> {
    requireRole(input.auth, SECRET_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();
    const ciphertext = deps.cipher.encrypt(input.secret);

    const provider = createPaymentProvider(input.provider);
    const existing = await deps.secrets.findByOrgProvider(organizationId, provider);
    const desired = existing
      ? existing.replaceCiphertext(ciphertext, now)
      : InboundWebhookSecret.create({
          id: deps.generateInboundWebhookSecretId(),
          organizationId,
          provider,
          ciphertext,
          now,
        });

    await deps.secrets.save(desired);
    return { provider: desired.provider, updatedAt: desired.updatedAt };
  };
}
