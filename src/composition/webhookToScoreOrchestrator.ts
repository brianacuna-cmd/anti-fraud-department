import { createIngestSystemAuthContext } from '../modules/ingest/application/createIngestSystemAuthContext.js';
import type { IngestedPaymentEvent } from '../modules/ingest/domain/model/IngestedPaymentEvent.js';
import type { ProviderIngestEventId } from '../modules/ingest/domain/model/value-objects/ProviderIngestEventId.js';
import type { PostAckComposer } from '../modules/ingest/domain/ports/PostAckComposer.js';
import type { ProviderIngestEventRepository } from '../modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import { createCanonicalRiskEvent } from '../modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { Clock } from '../shared/time/Clock.js';
import type { createScoreToCaseOrchestrator } from './scoreToCaseOrchestrator.js';

export interface WebhookToScoreOrchestratorDeps {
  readonly processRiskScoreToCase: ReturnType<typeof createScoreToCaseOrchestrator>;
  readonly events: ProviderIngestEventRepository;
  readonly clock: Clock;
  readonly onError?: (error: unknown, ctx: { stage: string; ingestEventId?: string }) => void;
}

/**
 * Composition-only PostAckComposer (design A1/D3/D4). Maps ingest DTO →
 * CanonicalRiskEvent, calls processRiskScoreToCase with a system AuthContext,
 * and records PROCESSED/FAILED. Ingest application must not import scoring.
 */
export function createWebhookToScoreOrchestrator(deps: WebhookToScoreOrchestratorDeps): PostAckComposer {
  const onError = deps.onError ?? defaultOnError;
  return {
    async compose(input) {
      try {
        await deps.processRiskScoreToCase({
          auth: createIngestSystemAuthContext(input.organizationId, input.provider),
          event: toCanonicalRiskEvent(input.event),
        });
        await persistOutcome(deps, input, 'processed', onError);
      } catch (error) {
        onError(error, { stage: 'compose', ingestEventId: input.ingestEventId });
        await persistOutcome(deps, input, 'failed', onError);
      }
    },
  };
}

function defaultOnError(error: unknown, ctx: { stage: string; ingestEventId?: string }): void {
  console.error('webhookToScore', { ...ctx, error });
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
  onError: (error: unknown, ctx: { stage: string; ingestEventId?: string }) => void,
): Promise<void> {
  const row = await deps.events.findById(input.ingestEventId as ProviderIngestEventId);
  if (row === null) {
    onError(new Error('provider ingest event not found for post-ack outcome'), {
      stage: 'persistOutcome',
      ingestEventId: input.ingestEventId,
    });
    return;
  }
  const now = deps.clock.now();
  const next = outcome === 'processed' ? row.markProcessed(now) : row.markFailed(now);
  await deps.events.save(next);
}
