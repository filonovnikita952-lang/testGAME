# Email OTP Service (Node.js + TypeScript + Express)

A production-oriented email OTP module for registration/verification using Gmail SMTP + Google App Password.

## Features

- `POST /auth/request-otp`
- `POST /auth/verify-otp`
- `GET /health`
- 6-digit numeric OTP
- OTP TTL: 10 minutes (configurable)
- One-time use OTP
- Max attempts per OTP: 5, then 15-minute email lock (configurable)
- OTP stored hashed (HMAC-SHA256 + server secret), never plaintext
- Timing-safe hash comparison
- Per-IP and per-email rate limiting for request + verify routes
- SQLite persistence
- SMTP send with STARTTLS default (587), fallback to SSL (465)
- Safe logging (no OTP values)

## OTP strategy for re-requests

This implementation **invalidates previous active OTPs** whenever a new OTP is requested for the same email.

## Prerequisites

- Node.js 20+
- npm
- Gmail account with:
  - 2FA enabled
  - App Password generated

## Setup (Windows 11)

1. Open PowerShell and go to project directory:
   ```powershell
   cd /workspace/testGAME/email-otp-service
   ```
2. Install dependencies:
   ```powershell
   npm install
   ```
3. Create your env file from template:
   ```powershell
   Copy-Item .env.example .env
   ```
4. Edit `.env` and set your real values (especially `OTP_SECRET`, `SMTP_USER`, `SMTP_PASS`).
5. Initialize database schema:
   ```powershell
   npm run init-db
   ```
6. Start development server:
   ```powershell
   npm run dev
   ```

## Environment variables

See `.env.example`.

Required SMTP values:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USER=<your gmail address>`
- `SMTP_PASS=<google app password>`
- `SMTP_FROM_NAME=<site name>`

## API usage examples (curl)

### Health

```bash
curl -X GET http://localhost:3000/health
```

### Request OTP

```bash
curl -X POST http://localhost:3000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

### Verify OTP

```bash
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","code":"123456"}'
```

## Test

```bash
npm test
```

## Security notes

- Never commit `.env`.
- Rotate App Password if leaked.
- Use a strong `OTP_SECRET` (at least 32 random chars).
- Logs intentionally avoid OTP values.

## Gmail SMTP limits and production advice

Gmail SMTP is practical for small/early-stage projects but has sending limits and stricter anti-abuse controls.
For higher volume or mission-critical delivery, migrate to a transactional provider such as SES, Postmark, SendGrid, Mailgun, etc.
