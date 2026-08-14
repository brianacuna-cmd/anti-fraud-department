import type { IngestedPaymentEvent } from '../../../../domain/model/IngestedPaymentEvent.js';

export type EnvelopeMapResult =
  | { status: 'mapped'; event: IngestedPaymentEvent }
  | { status: 'ignored'; reason: 'unknown_event_type' }
  | { status: 'failed'; reason: 'missing_customer' | 'unparsable_amount' };
