import { createCheckInAccessToken } from './checkinAccess.js';
import { sendEmailWithGmailOrResend, verifyEmailConfigOnStartup } from './email.js';

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '<invalid-email>';
  return `${local.slice(0, 2)}***@${domain}`;
}

function classifyEmailError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code.includes('AUTH') || code.includes('API_KEY') || code.includes('FORBIDDEN')) return 'authentication';
  if (code.includes('ECONN') || code.includes('ETIMEDOUT') || code.includes('ENOTFOUND')) return 'connection';
  return 'unknown';
}

export async function verifyEmailTransport() {
  if (!(await verifyEmailConfigOnStartup())) {
    const error = 'No email provider is configured.';
    console.error(`[CHECK-IN EMAIL] Email provider verification failed: category=configuration error=${error}`);
    return { success: false, error, category: 'configuration' };
  }

  console.log('[CHECK-IN EMAIL] Gmail API/Resend email configuration verified successfully.');
  return { success: true };
}

/** Send the reservation-specific guest check-in link. */
export async function sendCheckInEmail({ guestEmail, guestName, guestId, reservationId, roomId, checkInDate }) {
  const recipient = maskEmail(guestEmail);
  console.log(`[CHECK-IN EMAIL] send attempted recipient=${recipient} reservation=${reservationId}`);

  try {
    const normalizedEmail = String(guestEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      const error = 'Guest email address is missing or invalid.';
      console.error(`[CHECK-IN EMAIL] failed recipient=${recipient} category=invalid-recipient error=${error}`);
      return { success: false, emailSent: false, error, category: 'invalid-recipient' };
    }

    const appBaseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    const checkInToken = createCheckInAccessToken({
      reservationId,
      guestId,
    });
    const checkInUrl = `${appBaseUrl.replace(/\/$/, '')}/checkin?resId=${reservationId}&token=${encodeURIComponent(checkInToken)}`;

    const mailInfo = await sendEmailWithGmailOrResend({
          to: normalizedEmail,
          subject: `Complete Your Express Room Check-In (Reservation #${reservationId})`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc; color: #1e293b;">
              <div style="max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0;">
                <h2 style="color: #059669; margin-top: 0;">Welcome to InnKeeper Motel!</h2>
                <p>Hello <strong>${guestName}</strong>,</p>
                <p>Complete your Driving Licence verification, Razorpay payment, and check-in to receive your digital room key.</p>
                <div style="background-color: #f1f5f9; padding: 16px; border-radius: 12px; margin: 20px 0;">
                  <p style="margin: 4px 0;"><strong>Reservation ID:</strong> #${reservationId}</p>
                  <p style="margin: 4px 0;"><strong>Room Assigned:</strong> Room #${roomId || 101}</p>
                  <p style="margin: 4px 0;"><strong>Check-In Date:</strong> ${new Date(checkInDate).toLocaleDateString()}</p>
                </div>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${checkInUrl}" style="background-color: #059669; color: #ffffff; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
                    Complete Express Check-In Now &rarr;
                  </a>
                </div>
                <p style="font-size: 12px; color: #64748b; text-align: center;">If you did not request this booking, please contact front desk support.</p>
              </div>
            </div>
          `,
    });

    console.log(`[CHECK-IN EMAIL] sent recipient=${maskEmail(normalizedEmail)} reservation=${reservationId} messageId=${mailInfo.id}`);
    return { success: true, emailSent: true, email: normalizedEmail, checkInUrl, messageId: mailInfo.id };
  } catch (err) {
    const category = err?.category || classifyEmailError(err);
    const errorMessage = err?.message || 'Unable to deliver the check-in email.';
    console.error(`[CHECK-IN EMAIL] failed recipient=${recipient} reservation=${reservationId} category=${category} error=${errorMessage}`);
    return { success: false, emailSent: false, error: errorMessage, category };
  }
}

/**
 * Send password reset email to guest or staff
 */
export async function sendPasswordResetEmail({ toEmail, resetToken }) {
  try {
    const appBaseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${appBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(resetToken)}`;

    console.log(`[Auth] Attempting to send password reset email to ${maskEmail(toEmail)}`);

    const mailInfo = await sendEmailWithGmailOrResend({
      to: toEmail,
      subject: 'Reset Your InnKeeper Account Password',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Reset your InnKeeper password</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f6f8fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f6f8fa; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #d0d7de; border-radius: 8px; overflow: hidden; box-shadow: 0 3px 6px rgba(140,149,159,0.15);">
                  <tr>
                    <td style="padding: 28px 32px 16px 32px; border-bottom: 1px solid #e1e4e8;">
                      <span style="font-size: 18px; font-weight: 700; color: #1e293b;">InnKeeper PMS</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 24px 32px 32px 32px;">
                      <h1 style="font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 0; margin-bottom: 20px;">Reset your InnKeeper password</h1>
                      <p style="font-size: 14px; line-height: 1.6; color: #334155;">Hello,</p>
                      <p style="font-size: 14px; line-height: 1.6; color: #334155;">We received a request to reset your password for your InnKeeper account. You can use the button below to reset your password:</p>
                      <div style="margin: 24px 0;">
                        <a href="${resetUrl}" target="_blank" style="font-size: 14px; font-weight: 600; color: #ffffff; background-color: #2f6c85; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">Reset your password</a>
                      </div>
                      <p style="font-size: 13px; color: #64748b;">This password reset link will expire after 30 minutes.</p>
                      <p style="font-size: 13px; color: #64748b;">If you didn't request a password reset, you can safely ignore this email.</p>
                      <p style="font-size: 14px; color: #334155; margin-top: 24px; margin-bottom: 0;">Thanks,<br><strong>The InnKeeper Team</strong></p>
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

    console.log(`[Auth] Password reset email sent successfully (Message ID: ${mailInfo.id})`);
    return { success: true, resetUrl, messageId: mailInfo.id };
  } catch (err) {
    console.error('[Auth] Error sending email via Resend:', err.message);
    return { success: false, error: err.message };
  }
}
