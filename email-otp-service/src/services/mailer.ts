import nodemailer from 'nodemailer';
import { env } from '../config/env';

function getTransport(secure: boolean, port: number) {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });
}

export async function sendOtpEmail(email: string, otpCode: string): Promise<void> {
  const text = `Your verification code is: ${otpCode}\nThis code expires in ${env.OTP_TTL_MINUTES} minutes.\nIf you didn't request this, ignore this email.`;
  const html = `<p>Your verification code is: <strong>${otpCode}</strong></p><p>This code expires in ${env.OTP_TTL_MINUTES} minutes.</p><p>If you didn't request this, ignore this email.</p>`;

  const options = {
    from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_USER}>`,
    to: email,
    subject: 'Your verification code',
    text,
    html
  };

  const primaryTransport = getTransport(env.SMTP_SECURE, env.SMTP_PORT);

  try {
    await primaryTransport.sendMail(options);
    return;
  } catch (primaryError) {
    console.warn('Primary SMTP send failed, attempting fallback transport', {
      email,
      port: env.SMTP_PORT
    });

    const fallbackTransport = getTransport(env.SMTP_FALLBACK_SECURE, env.SMTP_FALLBACK_PORT);
    try {
      await fallbackTransport.sendMail(options);
    } catch (fallbackError) {
      throw new Error('SMTP delivery failed on both primary and fallback transports');
    }
  }
}
