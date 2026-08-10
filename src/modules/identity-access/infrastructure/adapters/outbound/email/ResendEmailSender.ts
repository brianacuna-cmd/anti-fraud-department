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
    send(payload: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
  };
}

/**
 * `EmailSender` backed by the Resend API (password-management PR-2a,
 * design §4). The composition root only constructs this when
 * `RESEND_API_KEY` is set — otherwise `LogEmailSender` is used instead.
 */
export class ResendEmailSender implements EmailSender {
  private readonly client: ResendClient;

  constructor(apiKeyOrClient: string | ResendClient) {
    this.client = typeof apiKeyOrClient === 'string' ? new Resend(apiKeyOrClient) : apiKeyOrClient;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.client.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
