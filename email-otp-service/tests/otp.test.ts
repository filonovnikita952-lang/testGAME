import { describe, expect, it } from 'vitest';
import { hashOtp, isExpired, verifyOtpHash } from '../src/utils/otp';

describe('OTP hashing and verification', () => {
  const secret = 'test-secret-key-which-is-at-least-32-chars';
  const email = 'person@example.com';
  const otp = '123456';

  it('hashes and verifies a valid OTP', () => {
    const hash = hashOtp(email, otp, secret);
    expect(hash).toHaveLength(64);
    expect(verifyOtpHash(email, otp, hash, secret)).toBe(true);
  });

  it('fails verification with incorrect OTP', () => {
    const hash = hashOtp(email, otp, secret);
    expect(verifyOtpHash(email, '654321', hash, secret)).toBe(false);
  });
});

describe('TTL behavior', () => {
  it('returns false when expiration is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isExpired(future)).toBe(false);
  });

  it('returns true when expiration is in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isExpired(past)).toBe(true);
  });
});
