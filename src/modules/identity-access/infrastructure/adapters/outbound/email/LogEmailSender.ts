import type { EmailMessage, EmailSender } from '../../../../domain/ports/EmailSender.js';

/**
 * No-op fallback `EmailSender` (password-management PR-2a, design §4;
 * spec "Adapter fallback with no API key") — used by the composition root
 * when `RESEND_API_KEY` is not configured (local/dev/CI). Logs the message
 * instead of sending it, and never throws, so the caller's flow completes
 * normally.
 */
export class LogEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(`[LogEmailSender] would send email to=${message.to} subject=${JSON.stringify(message.subject)}`);
  }
}
