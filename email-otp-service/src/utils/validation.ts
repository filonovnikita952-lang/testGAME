import { z } from 'zod';

export const requestOtpSchema = z.object({
  email: z.string().email().max(320)
});

export const verifyOtpSchema = z.object({
  email: z.string().email().max(320),
  code: z.string().regex(/^\d{6}$/, 'Code must be a 6-digit numeric value')
});
