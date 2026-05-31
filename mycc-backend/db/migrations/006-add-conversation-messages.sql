-- Up
CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(100) REFERENCES conversations(session_id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_created_at
  ON conversation_messages(session_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_user_session
  ON conversation_messages(user_id, session_id);

-- Down (manual rollback only):
-- DROP INDEX IF EXISTS idx_conversation_messages_user_session;
-- DROP INDEX IF EXISTS idx_conversation_messages_session_created_at;
-- DROP TABLE IF EXISTS conversation_messages;
