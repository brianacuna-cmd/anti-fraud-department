import type { EmailMessage, EmailSender } from '../../../src/modules/identity-access/domain/ports/EmailSender.js';

/**
 * Records every send in `sent` — no real network I/O (password-management
 * PR-2a, spec "Fake sender in tests"). Used by request/confirm-reset use
 * case tests (PR-2b/PR-2c) to assert whether a send was invoked and with
 * what recipient, without ever hitting a real provider.
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}
