import { passwordResetEmailTemplate } from '../../../../src/modules/identity-access/application/auth/passwordResetEmailTemplate.js';

describe('passwordResetEmailTemplate', () => {
  const RESET_URL = 'https://app.example.com/reset?token=abc123';

  it('returns a fixed subject', () => {
    const content = passwordResetEmailTemplate({ resetUrl: RESET_URL, expiresInMinutes: 15 });
    expect(content.subject).toBe('Reset your password');
  });

  it('embeds the reset link in both the plain-text and HTML bodies', () => {
    const content = passwordResetEmailTemplate({ resetUrl: RESET_URL, expiresInMinutes: 15 });
    expect(content.text).toContain(RESET_URL);
    expect(content.html).toContain(`href="${RESET_URL}"`);
  });

  it('states the expiry window in both bodies', () => {
    const content = passwordResetEmailTemplate({ resetUrl: RESET_URL, expiresInMinutes: 30 });
    expect(content.text).toContain('30 minutes');
    expect(content.html).toContain('30 minutes');
  });

  it('HTML-escapes ampersands in the URL so multi-param links stay valid markup', () => {
    const url = 'https://app.example.com/reset?token=abc&lang=en';
    const content = passwordResetEmailTemplate({ resetUrl: url, expiresInMinutes: 15 });
    expect(content.html).toContain('token=abc&amp;lang=en');
    expect(content.html).not.toContain('token=abc&lang=en');
    // The plain-text fallback keeps the raw, clickable URL untouched.
    expect(content.text).toContain(url);
  });
});
