import type { Clock } from '../../../../../shared/time/Clock.js';
import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CustomerOutgoingEventRepository } from '../../../domain/ports/CustomerOutgoingEventRepository.js';
import type { OutgoingWebhookClient } from '../../../domain/ports/OutgoingWebhookClient.js';
import type { OrganizationFraudConfigRepository } from '../../../domain/ports/OrganizationFraudConfigRepository.js';
import type { UnitOfWork } from '../../../domain/ports/UnitOfWork.js';
import type { OutboxDlqRepository } from '../../../../../shared/outbox/OutboxDlqRepository.js';
import { DeadLetterEvent } from '../../../../../shared/outbox/DeadLetterEvent.js';

export type Sleeper = (ms: number) => Promise<void>;

export interface CustomerOutgoingEventDispatcherDeps {
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly webhookClient: OutgoingWebhookClient;
  /**
   * Where each tenant's signing secret comes from (EVT-003). Optional so
   * existing mounts are not broken: without it, deliveries go unsigned just
   * as before.
   */
  readonly fraudConfig?: OrganizationFraudConfigRepository;
  readonly clock: Clock;
  /** Injectable delay used by `start()` between poll ticks (tests: FakeSleeper). */
  readonly sleeper?: Sleeper;
  readonly claimLimit?: number;
  readonly onError?: (error: unknown) => void;
  /**
   * Optional catalog/observability wrapper around one poll tick.
   * `start()` and the returned `dispatchOnce` share the same wrapped tick.
   */
  readonly wrapTick?: (tick: () => Promise<DispatchOnceResult>) => Promise<DispatchOnceResult>;
  readonly unitOfWork?: UnitOfWork;
  readonly dlq?: OutboxDlqRepository;
}

export interface DispatchOnceResult {
  readonly processed: number;
  readonly sent: number;
  readonly failed: number;
}

export interface DispatcherHandle {
  stop(): void;
}

const DEFAULT_CLAIM_LIMIT = 50;

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Polls `customer_outgoing_events` PENDING rows, POSTs via `OutgoingWebhookClient`,
 * and marks SENT (2xx) or records failures until FAILED at attempt 5.
 * Backoff between attempts is enforced by `claimPending` (1s,2s,4s,8s,16s schedule).
 */
export function createCustomerOutgoingEventDispatcher(deps: CustomerOutgoingEventDispatcherDeps) {
  const claimLimit = deps.claimLimit ?? DEFAULT_CLAIM_LIMIT;
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError = deps.onError ?? ((error: unknown) => {
    console.error('CustomerOutgoingEventDispatcher error:', error);
  });

  async function dispatchOnce(): Promise<DispatchOnceResult> {
    const now = deps.clock.now();
    const claimed = await deps.outgoingEvents.claimPending(now, claimLimit);
    let sent = 0;
    let failed = 0;
    // A batch touches few tenants and many events: without a cache this would
    // be a config lookup per delivered event.
    const secrets = new Map<string, SigningMaterial>();

    for (const event of claimed) {
      let responseStatus = 0;
      let ok = false;
      try {
        const signing = await resolveSigning(secrets, event.organizationId);
        const nowForHeaders = deps.clock.now();
        const previousSecret = previousSecretIfInGrace(signing, nowForHeaders);
        const result = await deps.webhookClient.post({
          url: event.webhookUrl,
          payload: { ...event.payload },
          secret: signing.current,
          ...(previousSecret === null ? {} : { previousSecret }),
        });
        responseStatus = result.statusCode;
        ok = result.ok;
      } catch {
        responseStatus = 0;
        ok = false;
      }

      if (ok) {
        const updated = event.markSent({ responseStatus, now: deps.clock.now() });
        await deps.outgoingEvents.save(updated);
        sent += 1;
      } else {
        const updated = event.recordFailure({ responseStatus, now: deps.clock.now() });
        if (updated.status === 'FAILED' && deps.unitOfWork !== undefined && deps.dlq !== undefined) {
          await deps.unitOfWork.withTransaction(async (tx) => {
            await deps.outgoingEvents.save(updated, tx);
            await deps.dlq!.save(
              DeadLetterEvent.fromCustomerOutgoingEvent(
                {
                  id: String(updated.id),
                  organizationId: updated.organizationId,
                  eventType: updated.eventType,
                  payload: { ...updated.payload },
                  attempts: updated.attempts,
                  createdAt: updated.createdAt,
                  responseStatus: updated.responseStatus,
                },
                deps.clock.now(),
              ),
              tx,
            );
          });
          failed += 1;
        } else {
          await deps.outgoingEvents.save(updated);
          if (updated.status === 'FAILED') {
            failed += 1;
          }
        }
      }
    }

    return { processed: claimed.length, sent, failed };
  }

  /**
   * Failure to read the config does NOT take the delivery down: it is sent
   * unsigned.
   *
   * It is debatable and this direction is on purpose. These deliveries are
   * lifts and applications of sanctions on real customers; stopping them
   * because a config read failed leaves restrictions in place longer than
   * they should be. A receiver that requires a signature will reject the
   * send and it will be retried with the normal backoff.
   */
  async function resolveSigning(
    cache: Map<string, SigningMaterial>,
    organizationId: string,
  ): Promise<SigningMaterial> {
    if (deps.fraudConfig === undefined) {
      return { current: null, previous: null, graceExpiresAt: null };
    }
    const cached = cache.get(organizationId);
    if (cached !== undefined) {
      return cached;
    }
    const material = await readSigning(deps.fraudConfig, organizationId).catch((error: unknown) => {
      onError(error);
      return { current: null, previous: null, graceExpiresAt: null };
    });
    cache.set(organizationId, material);
    return material;
  }

  const runTick = (): Promise<DispatchOnceResult> =>
    deps.wrapTick ? deps.wrapTick(dispatchOnce) : dispatchOnce();

  function start(intervalMs: number): DispatcherHandle {
    let stopped = false;
    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          await runTick();
        } catch (error) {
          onError(error);
        }
        if (stopped) {
          break;
        }
        await sleeper(intervalMs);
      }
    };
    void run();
    return {
      stop(): void {
        stopped = true;
      },
    };
  }

  return { dispatchOnce: runTick, start };
}

interface SigningMaterial {
  readonly current: string | null;
  readonly previous: string | null;
  readonly graceExpiresAt: Instant | null;
}

function previousSecretIfInGrace(material: SigningMaterial, now: Instant): string | null {
  if (material.previous === null || material.previous.length === 0) {
    return null;
  }
  if (material.graceExpiresAt === null || now >= material.graceExpiresAt) {
    return null;
  }
  return material.previous;
}

async function readSigning(
  fraudConfig: OrganizationFraudConfigRepository,
  organizationId: string,
): Promise<SigningMaterial> {
  const config = await fraudConfig.findByOrganization(organizationId);
  return {
    current: config?.outboundWebhookSecret ?? null,
    previous: config?.outboundWebhookPreviousSecret ?? null,
    graceExpiresAt: config?.outboundWebhookSecretGraceExpiresAt ?? null,
  };
}
