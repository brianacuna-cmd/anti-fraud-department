import type { NotificationOrgConfigRepository } from '../modules/notifications/domain/ports/NotificationOrgConfigRepository.js';
import type {
  NotificationWebhookInput,
  NotificationWebhookSender,
} from '../modules/notifications/domain/ports/NotificationWebhookSender.js';

export interface NotificationWebhookSenderAdapterOptions {
  /** Injectable fetch for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Composition bridge (wiring root — allowed to cross module boundaries):
 * adapts the notifications `NotificationWebhookSender` port to a plain HTTP
 * POST. Resolves the org's `webhookUrl` via `NotificationOrgConfigRepository`
 * OUTSIDE any caller transaction (ADR-3 — the config read is best-effort and
 * must never roll back the caller's tx or the in-app row). When no config
 * row exists, or `webhookUrl` is `null`, sending is a silent no-op (ADR-3 /
 * spec Req 2 scenario 2). The POST body is a generic Slack-incoming-webhook
 * compatible payload `{ text, alertType, context }` (spec Req 2). No HMAC
 * signing in this change (Req 4) — the org's `secret` field is stored but
 * unused here.
 */
export function createNotificationWebhookSenderAdapter(
  orgConfigRepository: NotificationOrgConfigRepository,
  options: NotificationWebhookSenderAdapterOptions = {},
): NotificationWebhookSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async send(input: NotificationWebhookInput): Promise<void> {
      const config = await orgConfigRepository.findByOrganization(input.organizationId);
      const webhookUrl = config?.webhookUrl ?? null;
      if (webhookUrl === null) {
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const body = JSON.stringify({
        text: buildText(input),
        alertType: input.alertType,
        context: input.context,
      });
      try {
        const response = await fetchImpl(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Notification webhook delivery failed with status ${response.status}`);
        }
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function buildText(input: NotificationWebhookInput): string {
  const details = Object.entries(input.context)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n');
  const body = `Tenés una nueva alerta de tipo ${input.alertType}.`;
  return details.length > 0 ? `${body}\n\n${details}` : body;
}
