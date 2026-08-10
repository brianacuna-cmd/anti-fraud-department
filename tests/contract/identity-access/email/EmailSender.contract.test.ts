import type { EmailMessage, EmailSender } from '../../../../src/modules/identity-access/domain/ports/EmailSender.js';

/**
 * Compile-level contract test (password-management PR-2a, task 8): pins the
 * `EmailSender`/`EmailMessage` shape that `ResendEmailSender`,
 * `LogEmailSender`, and `FakeEmailSender` (tasks 9-10) all implement
 * against. If this file fails to compile, one of those adapters has drifted
 * from the port.
 */
describe('EmailSender port contract', () => {
  it('accepts an implementation whose send() takes an EmailMessage and resolves void', async () => {
    const messages: EmailMessage[] = [];
    const sender: EmailSender = {
      send: async (message: EmailMessage) => {
        messages.push(message);
      },
    };

    await sender.send({ to: 'user@example.com', from: 'noreply@example.com', subject: 'Subject', text: 'Body' });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.to).toBe('user@example.com');
  });

  it('allows html to be omitted (text-only message is valid)', async () => {
    const sender: EmailSender = {
      send: async () => undefined,
    };

    await expect(
      sender.send({ to: 'user@example.com', from: 'noreply@example.com', subject: 'Subject', text: 'Body' }),
    ).resolves.toBeUndefined();
  });

  it('allows html to be present alongside text', async () => {
    const sender: EmailSender = {
      send: async () => undefined,
    };

    await expect(
      sender.send({
        to: 'user@example.com',
        from: 'noreply@example.com',
        subject: 'Subject',
        text: 'Body',
        html: '<p>Body</p>',
      }),
    ).resolves.toBeUndefined();
  });
});
