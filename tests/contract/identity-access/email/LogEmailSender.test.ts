import { LogEmailSender } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/email/LogEmailSender.js';

describe('LogEmailSender (spec: "Adapter fallback with no API key")', () => {
  it('never throws and completes normally', async () => {
    const sender = new LogEmailSender();

    await expect(
      sender.send({ to: 'user@example.com', from: 'noreply@example.com', subject: 'Subject', text: 'Body' }),
    ).resolves.toBeUndefined();
  });

  it('logs the recipient and subject instead of sending', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const sender = new LogEmailSender();

    await sender.send({ to: 'user@example.com', from: 'noreply@example.com', subject: 'Reset', text: 'Body' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    logSpy.mockRestore();
  });
});
