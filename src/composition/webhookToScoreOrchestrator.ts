import { createIngestSystemAuthContext } from '../modules/ingest/application/createIngestSystemAuthContext.js';
import type { IngestedPaymentEvent } from '../modules/ingest/domain/model/IngestedPaymentEvent.js';
import { createPaymentProvider } from '../modules/ingest/domain/model/value-objects/PaymentProvider.js';
import type { PostAckComposer } from '../modules/ingest/domain/ports/PostAckComposer.js';
import type { ProviderIngestEventRepository } from '../modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import { createCanonicalRiskEvent } from '../modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { Clock } from '../shared/time/Clock.js';
import type { createScoreToCaseOrchestrator } from './scoreToCaseOrchestrator.js';

export interface WebhookToScoreOrchestratorDeps {
  readonly processRiskScoreToCase: ReturnType<typeof createScoreToCaseOrchestrator>;
  readonly events: ProviderIngestEventRepository;
  readonly clock: Clock;
}

/**
 * Composition-only PostAckComposer (design A1/D3/D4). Maps ingest DTO →
 * CanonicalRiskEvent, calls processRiskScoreToCase with a system AuthContext,
 * and records PROCESSED/FAILED. Ingest application must not import scoring.
 */
export function createWebhookToScoreOrchestrator(deps: WebhookToScoreOrchestratorDeps): PostAckComposer {
  return {
    async compose(input) {
      try {
        await deps.processRiskScoreToCase({
          auth: createIngestSystemAuthContext(input.organizationId, input.provider),
          event: toCanonicalRiskEvent(input.event),
        });
        await persistOutcome(deps, input, 'processed');
      } catch {
        await persistOutcome(deps, input, 'failed');
      }
    },
  };
}

function toCanonicalRiskEvent(event: IngestedPaymentEvent) {
  return createCanonicalRiskEvent({
    provider: event.provider,
    providerEventType: event.providerEventType,
    caseCustomerId: event.caseCustomerId,
    amountCents: event.amountCents,
    currency: event.currency,
    riskSignals: event.riskSignals,
    createdAt: event.createdAt,
    ...(event.eventId !== undefined ? { eventId: event.eventId } : {}),
    ...(event.providerEventId !== undefined ? { providerEventId: event.providerEventId } : {}),
    ...(event.rail !== undefined ? { rail: event.rail } : {}),
    ...(event.rawPayload !== undefined ? { rawPayload: event.rawPayload } : {}),
  });
}

async function persistOutcome(
  deps: WebhookToScoreOrchestratorDeps,
  input: {
    organizationId: string;
    provider: string;
    event: IngestedPaymentEvent;
    ingestEventId: string;
  },
  outcome: 'processed' | 'failed',
): Promise<void> {
  const providerEventId = input.event.providerEventId;
  if (providerEventId === undefined) {
    return;
  }
  const row = await deps.events.findByOrgProviderEvent(
    input.organizationId,
    createPaymentProvider(input.provider),
    providerEventId,
  );
  if (row === null) {
    return;
  }
  const now = deps.clock.now();
  const next = outcome === 'processed' ? row.markProcessed(now) : row.markFailed(now);
  await deps.events.save(next);
}
