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

/** Fails the first N calls, then succeeds — for exercising the retry loop. */
class FlakyResendClient implements ResendClient {
  callCount = 0;
  constructor(
    private readonly failures: number,
    private readonly mode: 'throw' | 'resolveError' = 'throw',
  ) {}
  emails = {
    send: async () => {
      this.callCount++;
      if (this.callCount <= this.failures) {
        if (this.mode === 'throw') {
          throw new Error('Unable to fetch data. The request could not be resolved.');
        }
        return { data: null, error: { name: 'application_error', message: 'network blip' } };
      }
      return { data: { id: 'email-ok' }, error: null };
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

  describe('resiliencia ante blips transitorios (DNS/red)', () => {
    it('reintenta y entrega si una falla que LANZA se recupera antes de agotar los intentos', async () => {
      const client = new FlakyResendClient(1, 'throw');
      const sender = new ResendEmailSender(client);

      await expect(
        sender.send({ to: 'a@example.com', from: 'noreply@example.com', subject: 's', text: 't' }),
      ).resolves.toBeUndefined();
      expect(client.callCount).toBe(2);
    });

    it('convierte un `{error}` RESUELTO (no lanzado) del SDK en una excepción real', async () => {
      // El SDK de Resend no siempre lanza: un blip de red vuelve como
      // `{data: null, error: {...}}` resuelto. Sin esta conversión, el
      // caller nunca se entera de que el envío falló.
      const client: ResendClient = {
        emails: {
          send: async () => ({ data: null, error: { name: 'application_error', message: 'no resuelto' } }),
        },
      };
      const sender = new ResendEmailSender(client);

      await expect(
        sender.send({ to: 'a@example.com', from: 'noreply@example.com', subject: 's', text: 't' }),
      ).rejects.toThrow(/application_error/);
    });

    it('reintenta un `{error}` resuelto igual que una excepción lanzada', async () => {
      const client = new FlakyResendClient(2, 'resolveError');
      const sender = new ResendEmailSender(client);

      await expect(
        sender.send({ to: 'a@example.com', from: 'noreply@example.com', subject: 's', text: 't' }),
      ).resolves.toBeUndefined();
      expect(client.callCount).toBe(3);
    });

    it('se rinde y lanza el último error tras agotar todos los intentos', async () => {
      const client = new FlakyResendClient(99, 'throw');
      const sender = new ResendEmailSender(client);

      await expect(
        sender.send({ to: 'a@example.com', from: 'noreply@example.com', subject: 's', text: 't' }),
      ).rejects.toThrow(/could not be resolved/);
      // 3 intentos totales (1 + 2 reintentos), nunca más.
      expect(client.callCount).toBe(3);
    });
  });
});
