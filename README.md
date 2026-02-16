# Signup OTP Verification Flow

## Overview
This app now uses a **2-step signup** process so accounts are only created after OTP verification succeeds.

1. `POST /signup/request`
   - Validates email/password/nickname.
   - Calls OTP service `POST /auth/request-otp`.
   - If OTP service fails, no account is created.
   - On success, stores pending signup in `pending_signup` table with expiry.
2. `POST /signup/verify`
   - Validates email + OTP code.
   - Calls OTP service `POST /auth/verify-otp`.
   - On success, creates `userid` record with `status=ACTIVE`, deletes pending record, and starts session.

### OTP service configuration
Set OTP base URL using environment variable:

```bash
export OTP_SERVICE_URL=http://localhost:3000
```

If not set, default is `http://localhost:3000`.

### cURL examples

Request signup OTP:

```bash
curl -X POST http://localhost:5000/signup/request \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","nickname":"newuser","password":"Password123"}'
```

Verify OTP and create account:

```bash
curl -X POST http://localhost:5000/signup/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","code":"123456"}'
```

Login attempt before verification should fail (no active account exists yet):

```bash
curl -X POST http://localhost:5000/LogIn \
  -d 'email=newuser@example.com&password=Password123'
```
