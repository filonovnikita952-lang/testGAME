import { Router } from 'express';
import { requestOtp, verifyOtp } from '../services/otpService';
import {
  requestOtpEmailLimiter,
  requestOtpIpLimiter,
  verifyOtpEmailLimiter,
  verifyOtpIpLimiter
} from '../utils/rateLimiters';
import { requestOtpSchema, verifyOtpSchema } from '../utils/validation';

export const authRouter = Router();

authRouter.post('/request-otp', requestOtpIpLimiter, requestOtpEmailLimiter, async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request payload.' });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const ip = req.ip ?? 'unknown-ip';
  const userAgent = req.get('user-agent') ?? 'unknown-agent';

  try {
    await requestOtp(email, ip, userAgent);
    return res.status(200).json({ message: 'If the email is valid, a verification code has been sent.' });
  } catch {
    return res.status(503).json({ error: 'Unable to process OTP request right now. Please try again later.' });
  }
});

authRouter.post('/verify-otp', verifyOtpIpLimiter, verifyOtpEmailLimiter, async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request payload.' });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const code = parsed.data.code;

  const result = await verifyOtp(email, code);
  return res.status(result.statusCode).json({ message: result.message });
});
