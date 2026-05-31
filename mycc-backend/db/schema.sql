-- MyCC 商业化数据库 Schema
-- 创建时间: 2026-02-09

-- 用户表
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50),
  assistant_name VARCHAR(50),
  linux_user VARCHAR(50) UNIQUE NOT NULL,  -- mycc_u{id}
  status VARCHAR(20) DEFAULT 'active',
  is_initialized BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 订阅表
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  plan VARCHAR(20) NOT NULL,  -- free | basic | pro
  tokens_limit INTEGER NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  reset_at TIMESTAMP NOT NULL,  -- 每月1号重置
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 使用记录表
CREATE TABLE usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  session_id VARCHAR(100),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  model VARCHAR(50),
  cost_usd DECIMAL(10, 6),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 会话表（元数据）
CREATE TABLE conversations (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  session_id VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(200),
  message_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 会话正文快照（产品侧兜底，不依赖运行时历史文件）
CREATE TABLE conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(100) REFERENCES conversations(session_id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Remote IDE 会话表
CREATE TABLE ide_sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('e2b')),
  sandbox_id VARCHAR(120) NOT NULL,
  code_server_pid INTEGER NOT NULL,
  host VARCHAR(255) NOT NULL,
  traffic_access_token TEXT,
  port INTEGER NOT NULL,
  desktop_pid INTEGER,
  desktop_host VARCHAR(255),
  desktop_port INTEGER,
  access_mode VARCHAR(40) NOT NULL CHECK (access_mode IN ('mycc-proxy')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'stopped')),
  proxy_token UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 技能事件表（安装、更新、使用、失败等运营统计）
CREATE TABLE skill_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  skill_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN (
    'download',
    'install',
    'install_failed',
    'update',
    'update_failed',
    'use',
    'uninstall'
  )),
  version VARCHAR(80),
  source VARCHAR(80),
  target_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversation_messages_session_created_at
  ON conversation_messages(session_id, created_at, id);
CREATE INDEX idx_conversation_messages_user_session
  ON conversation_messages(user_id, session_id);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_ide_sessions_user_id ON ide_sessions(user_id);
CREATE INDEX idx_ide_sessions_status_expires_at ON ide_sessions(status, expires_at);
CREATE INDEX idx_skill_events_skill_id_event_type ON skill_events(skill_id, event_type);
CREATE INDEX idx_skill_events_user_id_created_at ON skill_events(user_id, created_at DESC);
CREATE INDEX idx_skill_events_created_at ON skill_events(created_at DESC);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ide_sessions_updated_at BEFORE UPDATE ON ide_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
