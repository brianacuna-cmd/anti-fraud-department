import type { PaymentProvider } from '../../../../domain/model/value-objects/PaymentProvider.js';
import { mapBridgeEnvelope } from './BridgeMapper.js';
import type { EnvelopeMapHints, EnvelopeMapResult } from './EnvelopeMapResult.js';
import { mapCoinflowEnvelope } from './CoinflowMapper.js';
import { mapStripeEnvelope } from './StripeMapper.js';

const MAPPERS: Record<PaymentProvider, (payload: unknown, hints: EnvelopeMapHints) => EnvelopeMapResult> = {
  stripe: mapStripeEnvelope,
  bridge: mapBridgeEnvelope,
  coinflow: mapCoinflowEnvelope,
};

export function mapProviderEnvelope(
  provider: PaymentProvider,
  payload: unknown,
  hints: EnvelopeMapHints = {},
): EnvelopeMapResult {
  return MAPPERS[provider](payload, hints);
}
