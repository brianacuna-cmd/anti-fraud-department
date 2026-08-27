import { Resend } from 'resend';
import type { EmailMessage, EmailSender } from '../../../../domain/ports/EmailSender.js';

/**
 * Minimal structural shape of the `resend` client that this adapter
 * depends on — lets tests inject a double instead of the real `Resend`
 * class, so `pnpm test` never makes a live network call (same intent as
 * every other outbound adapter's contract test, applied here via
 * dependency injection instead of a real local primitive).
 */
export interface ResendClient {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
    }): Promise<{ data: unknown; error: { name: string; message: string } | null }>;
  };
}

/** Up to 3 attempts total (1 try + 2 retries), short fixed backoff between them. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `EmailSender` backed by the Resend API (password-management PR-2a,
 * design §4). The composition root only constructs this when
 * `RESEND_API_KEY` is set — otherwise `LogEmailSender` is used instead.
 *
 * The Resend SDK does NOT throw for most failures — it resolves with
 * `{ data: null, error: {...} }` even for network-level faults (a DNS blip
 * reaching `api.resend.com` comes back as `error.name: 'application_error'`,
 * never a rejected promise). `EmailSender.send` is contracted to return
 * `Promise<void>` and signal failure by throwing (every caller's
 * `try/catch` — `RequestPasswordReset.ts`, `SendNotification.ts` — depends
 * on that), so a resolved `error` is converted into a thrown error here;
 * without this, a failed send looked identical to a successful one to
 * every caller.
 *
 * Retries up to `MAX_ATTEMPTS` times with a short fixed delay before
 * giving up and throwing — a transient blip (the same kind seen against
 * AWS Secrets Manager elsewhere in this codebase) should not cost the
 * email outright when trying again a moment later would have worked.
 */
export class ResendEmailSender implements EmailSender {
  private readonly client: ResendClient;

  constructor(apiKeyOrClient: string | ResendClient) {
    this.client = typeof apiKeyOrClient === 'string' ? (new Resend(apiKeyOrClient) as unknown as ResendClient) : apiKeyOrClient;
  }

  async send(message: EmailMessage): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.client.emails.send({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        if (result.error) {
          throw new Error(`Resend: ${result.error.name} — ${result.error.message}`);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }
    throw lastError;
  }
}
