import rateLimit from 'express-rate-limit';

function resolveIp(ip: string | undefined): string {
  return ip ?? 'unknown-ip';
}

export const requestOtpIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => resolveIp(req.ip),
  message: { error: 'Too many OTP requests from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const requestOtpEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => String(req.body?.email ?? '').toLowerCase(),
  skip: (req) => !req.body?.email,
  message: { error: 'Too many OTP requests for this email. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const verifyOtpIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => resolveIp(req.ip),
  message: { error: 'Too many OTP verification attempts from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const verifyOtpEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => String(req.body?.email ?? '').toLowerCase(),
  skip: (req) => !req.body?.email,
  message: { error: 'Too many OTP verification attempts for this email. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
