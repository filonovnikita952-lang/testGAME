export interface OtpRequestRecord {
  id: number;
  email: string;
  otp_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  attempt_count: number;
  last_sent_at: string;
  lock_until: string | null;
  ip: string;
  user_agent: string;
}
