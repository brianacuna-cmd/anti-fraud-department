import {
  ResendEmailSender,
  type ResendClient,
} from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/email/ResendEmailSender.js';

/** Records every `emails.send` call — no real network I/O (design §4). */
class FakeResendClient implements ResendClient {
  readonly calls: Array<{ from: string; to: string; subject: string; text: string; html?: string }> = [];
  emails = {
    send: async (payload: { from: string; to: string; subject: string; text: string; html?: string }) => {
      this.calls.push(payload);
      return { data: { id: 'email-1' }, error: null };
    },
  };
}

describe('ResendEmailSender', () => {
  it('maps an EmailMessage to a resend client emails.send() call', async () => {
    const client = new FakeResendClient();
    const sender = new ResendEmailSender(client);

    await sender.send({
      to: 'user@example.com',
      from: 'noreply@example.com',
      subject: 'Reset your password',
      text: 'Click the link.',
      html: '<p>Click the link.</p>',
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'Reset your password',
      text: 'Click the link.',
      html: '<p>Click the link.</p>',
    });
  });

  it('passes html as undefined when the message omits it', async () => {
    const client = new FakeResendClient();
    const sender = new ResendEmailSender(client);

    await sender.send({ to: 'user@example.com', from: 'noreply@example.com', subject: 'Subject', text: 'Body' });

    expect(client.calls[0]?.html).toBeUndefined();
  });

  it('constructs a real Resend client when given an API key string, without calling out to it', () => {
    expect(() => new ResendEmailSender('re_fake_test_key')).not.toThrow();
  });
});
