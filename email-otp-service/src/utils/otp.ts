import crypto from 'crypto';

export function generateOtpCode(): string {
  const value = crypto.randomInt(0, 1_000_000);
  return value.toString().padStart(6, '0');
}

export function hashOtp(email: string, otp: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${email}:${otp}`).digest('hex');
}

export function verifyOtpHash(email: string, providedOtp: string, storedHash: string, secret: string): boolean {
  const computed = hashOtp(email, providedOtp, secret);
  const storedBuffer = Buffer.from(storedHash, 'hex');
  const computedBuffer = Buffer.from(computed, 'hex');

  if (storedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, computedBuffer);
}

export function isExpired(expiresAtIso: string, now = new Date()): boolean {
  return new Date(expiresAtIso).getTime() <= now.getTime();
}
