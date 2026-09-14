/**
 * Renders the password-reset email content (subject + plain-text + HTML).
 * Pure — no I/O, no dependencies — so it is unit-tested in isolation and the
 * `RequestPasswordReset` use case stays focused on token issuance + delivery.
 *
 * The HTML is deliberately conservative: a single centered table, inline
 * styles only, and a button that is itself a plain `<a>` link — the subset
 * every mail client (Outlook included) renders reliably. The plain-text body
 * carries the same link as an accessible, spam-filter-friendly fallback for
 * clients that do not render HTML. Both bodies state the same expiry so the
 * copy never contradicts the token's real TTL (passed in by the caller).
 */
export interface PasswordResetEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface PasswordResetEmailInput {
  /** Full reset link, already including the `?token=...` query string. */
  readonly resetUrl: string;
  /** Minutes until the token expires — kept in sync with the real TTL. */
  readonly expiresInMinutes: number;
}

/** Escapes the five HTML-significant characters for safe embedding in markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function passwordResetEmailTemplate(input: PasswordResetEmailInput): PasswordResetEmailContent {
  const subject = 'Reset your password';

  const text = [
    'We received a request to reset your password.',
    '',
    `Use this link to choose a new one: ${input.resetUrl}`,
    '',
    `This link expires in ${input.expiresInMinutes} minutes. If you did not request a password reset, you can safely ignore this email.`,
  ].join('\n');

  const safeUrl = escapeHtml(input.resetUrl);
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background-color:#ffffff;border-radius:8px;border:1px solid #e4e4e7;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="padding:32px 32px 8px 32px;font-size:18px;font-weight:bold;color:#18181b;">
                Reset your password
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px;font-size:14px;line-height:22px;color:#3f3f46;">
                We received a request to reset your password. Click the button below to choose a new one.
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;" align="center">
                <a href="${safeUrl}" style="display:inline-block;background-color:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:6px;">
                  Reset password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;font-size:12px;line-height:20px;color:#71717a;">
                Or copy and paste this link into your browser:<br />
                <a href="${safeUrl}" style="color:#3f3f46;word-break:break-all;">${safeUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px;font-size:12px;line-height:20px;color:#a1a1aa;border-top:1px solid #e4e4e7;">
                This link expires in ${input.expiresInMinutes} minutes. If you did not request a password reset, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
