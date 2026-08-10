/**
 * A single email to be sent (password-management PR-2a, design §4). `html`
 * is optional — a plain-text-only message is valid.
 */
export interface EmailMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/**
 * Port for sending email (password-management PR-2a, design §4). Lives in
 * `domain/ports` — same location as every other port (`PasswordHasher`,
 * `SecretCipher`, `SessionTokenService`) — NOT under a `notifications`
 * module (design: "no new notifications module"), so `application` code
 * depends only on its own module's domain, keeping the eslint `boundaries`
 * rule clean. Concrete adapters (`ResendEmailSender`, `LogEmailSender`) live
 * in `infrastructure/adapters/outbound/email/`; tests substitute
 * `FakeEmailSender` to assert whether a send was invoked.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
