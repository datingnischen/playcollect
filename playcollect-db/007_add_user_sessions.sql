BEGIN;

CREATE TABLE IF NOT EXISTS app_user_sessions (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  user_agent         TEXT,
  ip_address         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS app_user_sessions_user_id_idx
  ON app_user_sessions (user_id);

CREATE INDEX IF NOT EXISTS app_user_sessions_active_idx
  ON app_user_sessions (session_token_hash, expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
