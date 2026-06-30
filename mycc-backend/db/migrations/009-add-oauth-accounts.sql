-- 第三方登录账号绑定
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'github')),
  provider_user_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  email_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_oauth_accounts_updated_at'
  ) THEN
    CREATE TRIGGER update_oauth_accounts_updated_at BEFORE UPDATE ON oauth_accounts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
