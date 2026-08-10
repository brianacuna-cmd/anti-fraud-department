import { FakeEmailSender } from '../../../helpers/identity-access/FakeEmailSender.js';

describe('FakeEmailSender (spec: "Fake sender in tests")', () => {
  it('records that a send was invoked with the expected recipient', async () => {
    const fake = new FakeEmailSender();

    await fake.send({
      to: 'user@example.com',
      from: 'noreply@example.com',
      subject: 'Reset your password',
      text: 'Click the link to reset your password.',
    });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.to).toBe('user@example.com');
    expect(fake.sent[0]?.subject).toBe('Reset your password');
  });

  it('does not record anything when send is never called', () => {
    const fake = new FakeEmailSender();

    expect(fake.sent).toHaveLength(0);
  });

  it('records multiple sends in order', async () => {
    const fake = new FakeEmailSender();

    await fake.send({ to: 'a@example.com', from: 'noreply@example.com', subject: 's1', text: 't1' });
    await fake.send({ to: 'b@example.com', from: 'noreply@example.com', subject: 's2', text: 't2' });

    expect(fake.sent.map((message) => message.to)).toEqual(['a@example.com', 'b@example.com']);
  });
});
