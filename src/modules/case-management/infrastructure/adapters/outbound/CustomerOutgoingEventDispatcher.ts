import type { Clock } from '../../../../../shared/time/Clock.js';
import type { CustomerOutgoingEventRepository } from '../../../domain/ports/CustomerOutgoingEventRepository.js';
import type { OutgoingWebhookClient } from '../../../domain/ports/OutgoingWebhookClient.js';
import type { OrganizationFraudConfigRepository } from '../../../domain/ports/OrganizationFraudConfigRepository.js';

export type Sleeper = (ms: number) => Promise<void>;

export interface CustomerOutgoingEventDispatcherDeps {
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly webhookClient: OutgoingWebhookClient;
  /**
   * De donde sale el secreto de firma de cada inquilino (EVT-003). Opcional
   * para no romper montajes existentes: sin el, las entregas salen sin firmar
   * igual que antes.
   */
  readonly fraudConfig?: OrganizationFraudConfigRepository;
  readonly clock: Clock;
  /** Injectable delay used by `start()` between poll ticks (tests: FakeSleeper). */
  readonly sleeper?: Sleeper;
  readonly claimLimit?: number;
  readonly onError?: (error: unknown) => void;
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
    // Una tanda toca pocos inquilinos y muchos eventos: sin cache esto seria
    // una consulta de configuracion por evento entregado.
    const secrets = new Map<string, string | null>();

    for (const event of claimed) {
      let responseStatus = 0;
      let ok = false;
      try {
        const result = await deps.webhookClient.post({
          url: event.webhookUrl,
          payload: { ...event.payload },
          secret: await resolveSecret(secrets, event.organizationId),
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
        await deps.outgoingEvents.save(updated);
        if (updated.status === 'FAILED') {
          failed += 1;
        }
      }
    }

    return { processed: claimed.length, sent, failed };
  }

  /**
   * El fallo al leer la configuracion NO tumba la entrega: se manda sin firma.
   *
   * Es discutible y va en esta direccion a proposito. Estas entregas son
   * levantamientos y aplicaciones de sancion sobre clientes reales; pararlas
   * porque una lectura de configuracion fallo deja restricciones puestas mas
   * tiempo del debido. El receptor que exija firma rechazara el envio y este
   * volvera a intentarse con el backoff normal.
   */
  async function resolveSecret(
    cache: Map<string, string | null>,
    organizationId: string,
  ): Promise<string | null> {
    if (deps.fraudConfig === undefined) {
      return null;
    }
    const cached = cache.get(organizationId);
    if (cached !== undefined) {
      return cached;
    }
    const secret = await readSecret(deps.fraudConfig, organizationId).catch((error: unknown) => {
      onError(error);
      return null;
    });
    cache.set(organizationId, secret);
    return secret;
  }

  function start(intervalMs: number): DispatcherHandle {
    let stopped = false;
    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          await dispatchOnce();
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

  return { dispatchOnce, start };
}

async function readSecret(
  fraudConfig: OrganizationFraudConfigRepository,
  organizationId: string,
): Promise<string | null> {
  const config = await fraudConfig.findByOrganization(organizationId);
  return config?.outboundWebhookSecret ?? null;
}
