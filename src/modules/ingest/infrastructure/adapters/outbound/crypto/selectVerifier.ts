import { invariantViolation } from '../../../../domain/errors/IngestError.js';
import type { PaymentProvider } from '../../../../domain/model/value-objects/PaymentProvider.js';
import type { WebhookSignatureVerifier } from '../../../../domain/ports/WebhookSignatureVerifier.js';
import { BridgePkiVerifier } from './BridgePkiVerifier.js';
import { CoinflowValidationKeyVerifier } from './CoinflowValidationKeyVerifier.js';
import { StripeHmacVerifier } from './StripeHmacVerifier.js';

const VERIFIERS: Record<PaymentProvider, () => WebhookSignatureVerifier> = {
  stripe: () => new StripeHmacVerifier(),
  bridge: () => new BridgePkiVerifier(),
  coinflow: () => new CoinflowValidationKeyVerifier(),
};

export function selectVerifier(provider: PaymentProvider): WebhookSignatureVerifier {
  const factory = VERIFIERS[provider];
  if (!factory) {
    throw invariantViolation('PaymentProvider must be one of stripe, bridge, coinflow', {
      value: provider,
    });
  }
  return factory();
}
