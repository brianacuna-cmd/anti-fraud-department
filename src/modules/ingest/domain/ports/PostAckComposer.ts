import type { IngestedPaymentEvent } from '../model/IngestedPaymentEvent.js';

/**
 * Post-ACK composition seam. Implemented in `webhookToScoreOrchestrator`
 * (composition root) — ingest application must not import scoring.
 */
export interface PostAckComposer {
  compose(input: {
    organizationId: string;
    provider: string;
    event: IngestedPaymentEvent;
    ingestEventId: string;
  }): Promise<void>;
}
