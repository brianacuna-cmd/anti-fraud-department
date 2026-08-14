import { invariantViolation } from '../../errors/IngestError.js';

export type PaymentProvider = 'stripe' | 'bridge' | 'coinflow';

const VALID: ReadonlySet<string> = new Set<PaymentProvider>(['stripe', 'bridge', 'coinflow']);

export function createPaymentProvider(value: string): PaymentProvider {
  if (!VALID.has(value)) {
    throw invariantViolation('PaymentProvider must be one of stripe, bridge, coinflow', { value });
  }
  return value as PaymentProvider;
}
