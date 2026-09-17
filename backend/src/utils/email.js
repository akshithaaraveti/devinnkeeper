import { Resend } from 'resend';

export class ResendEmailError extends Error {
  constructor(message, { category = 'resend-api', statusCode, code, name } = {}) {
    super(message);
    this.name = name || 'ResendEmailError';
    this.category = category;
    this.statusCode = statusCode;
    this.code = code;
  }
}

function redactEmailAddresses(message) {
  return String(message || 'Resend email delivery failed.')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
    .replace(/\b(re|sk)_[A-Za-z0-9_-]+\b/g, '<redacted-api-key>');
}

function classifyResendError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const code = String(error?.code || error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (statusCode === 401 || statusCode === 403 || /api.?key|unauthori[sz]ed|forbidden|authentication/.test(`${code} ${message}`)) {
    return 'authentication';
  }
  if (/from|sender|domain|identity|verified/.test(message) && /verify|valid|domain|identity|from|sender/.test(message)) {
    return 'unverified-sender';
  }
  if (statusCode === 422 || /recipient|\bto\b|invalid email|email address/.test(message)) {
    return 'invalid-recipient';
  }
  if (statusCode === 429 || /rate.?limit|too many requests/.test(message)) {
    return 'rate-limit';
  }
  if (/econn|etimedout|enotfound|network|fetch failed|timeout/.test(`${code} ${message}`)) {
    return 'connection';
  }
  return 'resend-api';
}

function toResendEmailError(error, fallbackMessage = 'Resend email delivery failed.') {
  return new ResendEmailError(redactEmailAddresses(error?.message || fallbackMessage), {
    category: error?.category || classifyResendError(error),
    statusCode: error?.statusCode || error?.status,
    code: error?.code,
    name: error?.name,
  });
}

function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || '').trim();
  const missing = [];
  if (!apiKey) missing.push('RESEND_API_KEY');
  if (!from) missing.push('EMAIL_FROM');
  return { apiKey, from, missing };
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '<invalid-email>';
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function sendEmailWithResend({ to, from, subject, text, html }) {
  const config = getResendConfig();
  if (config.missing.length > 0) {
    throw new ResendEmailError(`Resend configuration missing: ${config.missing.join(', ')}`, { category: 'configuration' });
  }

  const resend = new Resend(config.apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: from || config.from,
      to,
      subject,
      text,
      html,
    });

    if (error) {
      throw toResendEmailError(error);
    }
    if (!data?.id) {
      throw new ResendEmailError('Resend returned no message ID.', { category: 'resend-api' });
    }

    return data;
  } catch (error) {
    if (error instanceof ResendEmailError) throw error;
    throw toResendEmailError(error);
  }
}

/**
 * Sends a password reset email to a user with a secure reset link.
 * Reads configuration from environment variables without hardcoded credentials.
 *
 * @param {Object} params
 * @param {string} params.to - Destination email address
 * @param {string} params.token - Raw cryptographically secure reset token
 * @returns {Promise<{success: boolean, messageId?: string, resetUrl: string, error?: string}>}
 */
export async function sendPasswordResetEmail({ to, token, name }) {
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:5173';

  const resetUrl = `${appBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const firstName = name ? name.trim().split(' ')[0] : 'User';

  const config = getResendConfig();
  if (config.missing.length > 0) {
    config.missing.forEach((varName) => {
      console.error(`[Email Service] Missing ${varName}`);
    });
    const errorMsg = `Resend configuration (${config.missing.join(', ')}) is missing in .env`;
    return { success: false, error: errorMsg, resetUrl, deliveredViaSmtp: false, deliveredViaResend: false };
  }

  console.log('[Email Config] RESEND_API_KEY configured:', true);
  console.log('[Email Config] EMAIL_FROM configured:', true);
  console.log(`[Email Service] Attempting to send password reset email to ${maskEmail(to)} via Resend...`);

  try {
    const info = await sendEmailWithResend({
      from: config.from,
      to,
      subject: 'Reset your InnKeeper password',
      text: [
        `Hello ${firstName},`,
        ``,
        `We received a request to reset your InnKeeper account password.`,
        ``,
        `You can use the following link to reset your password:`,
        `${resetUrl}`,
        ``,
        `This password reset link will expire after 30 minutes.`,
        ``,
        `If you didn't request a password reset, you can safely ignore this email.`,
        ``,
        `Thanks,`,
        `The InnKeeper Team`,
      ].join('\n'),
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset your InnKeeper password</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f6f8fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #24292f; -webkit-font-smoothing: antialiased;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f6f8fa; padding: 40px 20px;">
            <tr>
              <td align="center">
                <!-- Outer Card Container -->
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #d0d7de; border-radius: 8px; border-collapse: separate; overflow: hidden; box-shadow: 0 3px 6px rgba(140,149,159,0.15);">
                  
                  <!-- Header Brand Bar -->
                  <tr>
                    <td style="padding: 28px 32px 16px 32px; text-align: left; border-bottom: 1px solid #hsla(210,18%,87%,1);">
                      <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="vertical-align: middle;">
                            <div style="background-color: #2f6c85; color: #ffffff; font-weight: bold; width: 36px; height: 36px; border-radius: 8px; text-align: center; line-height: 36px; font-size: 18px; font-family: Arial, sans-serif;">
                              IK
                            </div>
                          </td>
                          <td style="vertical-align: middle; padding-left: 12px;">
                            <span style="font-size: 18px; font-weight: 700; color: #1e293b; letter-spacing: -0.3px;">InnKeeper PMS</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Main Content Area -->
                  <tr>
                    <td style="padding: 24px 32px 32px 32px;">
                      <h1 style="font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 0; margin-bottom: 20px;">
                        Reset your InnKeeper password
                      </h1>

                      <p style="font-size: 14px; line-height: 1.6; color: #334155; margin-top: 0; margin-bottom: 16px;">
                        Hello <strong>${firstName}</strong>,
                      </p>

                      <p style="font-size: 14px; line-height: 1.6; color: #334155; margin-top: 0; margin-bottom: 20px;">
                        We received a request to reset your InnKeeper account password. You can use the following button to reset your password:
                      </p>

                      <!-- Action Button -->
                      <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                        <tr>
                          <td align="center" style="border-radius: 6px; background-color: #2f6c85;">
                            <a href="${resetUrl}" target="_blank" style="font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 12px 24px; border-radius: 6px; border: 1px solid #2f6c85;">
                              Reset your password
                            </a>
                          </td>
                        </tr>
                      </table>

                      <!-- Expiration and Safety notice -->
                      <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 24px; margin-bottom: 12px;">
                        This password reset link will expire after <strong>30 minutes</strong>.
                      </p>

                      <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 0; margin-bottom: 24px;">
                        If you didn't request a password reset, you can safely ignore this email.
                      </p>

                      <!-- Signoff -->
                      <p style="font-size: 14px; line-height: 1.5; color: #334155; margin-top: 0; margin-bottom: 0;">
                        Thanks,<br>
                        <strong>The InnKeeper Team</strong>
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8fafc; padding: 16px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
                      <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                        &copy; ${new Date().getFullYear()} InnKeeper PMS. All rights reserved.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    console.log(`[Email Service] Password reset email sent successfully (Message ID: ${info.id})`);
    return { success: true, messageId: info.id, resetUrl, deliveredViaSmtp: false, deliveredViaResend: true };
  } catch (error) {
    console.error(`[Email Service] Resend Error: ${error.message}`);
    return { success: false, error: error.message, resetUrl, deliveredViaSmtp: false, deliveredViaResend: false };
  }
}

/**
 * Safely verifies email configuration on backend startup without exposing secrets.
 */
export async function verifyEmailConfigOnStartup() {
  const config = getResendConfig();

  console.log('[Email Config] Running from:', process.cwd());
  console.log('[Email Config] RESEND_API_KEY configured:', !!config.apiKey);
  console.log('[Email Config] EMAIL_FROM configured:', !!config.from);

  if (config.missing.length > 0) {
    console.log(`[Email Service] Resend verification: SKIPPED (${config.missing.join(', ')} missing)`);
    return false;
  }

  console.log('[Email Service] Resend configuration verified: SUCCESS');
  return true;
}
