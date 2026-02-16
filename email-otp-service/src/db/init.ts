import { run } from './database';

export async function ensureSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS otp_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT NOT NULL,
      lock_until TEXT,
      ip TEXT NOT NULL,
      user_agent TEXT NOT NULL
    )
  `);

  await run('CREATE INDEX IF NOT EXISTS idx_otp_email_created ON otp_requests(email, created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_requests(expires_at)');
}
