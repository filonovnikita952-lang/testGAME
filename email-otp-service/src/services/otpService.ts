import { env } from '../config/env';
import { get, run } from '../db/database';
import { OtpRequestRecord } from '../types/otp';
import { generateOtpCode, hashOtp, isExpired, verifyOtpHash } from '../utils/otp';
import { sendOtpEmail } from './mailer';

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutesIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function requestOtp(email: string, ip: string, userAgent: string) {
  const otpCode = generateOtpCode();
  const otpHash = hashOtp(email, otpCode, env.OTP_SECRET);
  const createdAt = nowIso();
  const expiresAt = addMinutesIso(env.OTP_TTL_MINUTES);

  try {
    await sendOtpEmail(email, otpCode);

    await run(
      `UPDATE otp_requests
       SET expires_at = ?, used_at = COALESCE(used_at, ?)
       WHERE email = ? AND used_at IS NULL AND expires_at > ?`,
      [createdAt, createdAt, email, createdAt]
    );

    await run(
      `INSERT INTO otp_requests (email, otp_hash, created_at, expires_at, used_at, attempt_count, last_sent_at, lock_until, ip, user_agent)
       VALUES (?, ?, ?, ?, NULL, 0, ?, NULL, ?, ?)`,
      [email, otpHash, createdAt, expiresAt, createdAt, ip, userAgent]
    );

    console.info('OTP request created and email sent', { email, ip });
  } catch (error) {
    console.error('OTP request failed before persistence', { email, ip, error: (error as Error).message });
    throw new Error('Unable to send verification email right now. Please try again later.');
  }
}

export async function verifyOtp(email: string, otpCode: string) {
  const record = await get<OtpRequestRecord>(
    `SELECT * FROM otp_requests
     WHERE email = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  );

  if (!record) {
    return { success: false, statusCode: 400, message: 'Invalid or expired code.' };
  }

  const now = nowIso();

  if (record.lock_until && new Date(record.lock_until).getTime() > Date.now()) {
    return {
      success: false,
      statusCode: 429,
      message: 'Too many attempts. Verification is temporarily locked for this email.'
    };
  }

  if (record.used_at || isExpired(record.expires_at)) {
    return { success: false, statusCode: 400, message: 'Invalid or expired code.' };
  }

  const isValid = verifyOtpHash(email, otpCode, record.otp_hash, env.OTP_SECRET);

  if (!isValid) {
    const newAttemptCount = record.attempt_count + 1;
    const shouldLock = newAttemptCount >= env.OTP_MAX_ATTEMPTS;
    const lockUntil = shouldLock ? addMinutesIso(env.OTP_LOCK_MINUTES) : null;

    await run('UPDATE otp_requests SET attempt_count = ?, lock_until = ? WHERE id = ?', [
      newAttemptCount,
      lockUntil,
      record.id
    ]);

    console.warn('OTP verification failed', {
      email,
      attempts: newAttemptCount,
      locked: shouldLock
    });

    return {
      success: false,
      statusCode: shouldLock ? 429 : 400,
      message: shouldLock
        ? 'Too many attempts. Verification is temporarily locked for this email.'
        : 'Invalid or expired code.'
    };
  }

  await run('UPDATE otp_requests SET used_at = ? WHERE id = ?', [now, record.id]);
  console.info('OTP verification succeeded', { email, requestId: record.id });

  return { success: true, statusCode: 200, message: 'Email verified successfully.' };
}
