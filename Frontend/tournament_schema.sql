-- =============================================================================
-- OTTv2 Full Tournament Schema
-- Chạy file này trong Neon SQL Editor (chạy toàn bộ một lần)
-- =============================================================================

-- ─── 1. Upgrade arena_agents (nếu đã tồn tại) ───────────────────────────────
CREATE TABLE IF NOT EXISTS arena_agents (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_name      VARCHAR(100) NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  code            TEXT NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  -- active | pending | validating | rejected
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  validation_error TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Phiên bản đang tham gia arena (chỉ 1 active per user)
  is_active       BOOLEAN NOT NULL DEFAULT false,
  -- Stats (chỉ tính trận hợp lệ, không tính infra error)
  wins            INT NOT NULL DEFAULT 0,
  losses          INT NOT NULL DEFAULT 0,
  draws           INT NOT NULL DEFAULT 0,
  error_matches   INT NOT NULL DEFAULT 0,  -- infra errors, NOT counted in ELO
  elo             INT NOT NULL DEFAULT 1000
);

-- Thêm cột mới nếu bảng đã tồn tại
ALTER TABLE arena_agents ADD COLUMN IF NOT EXISTS version         INT NOT NULL DEFAULT 1;
ALTER TABLE arena_agents ADD COLUMN IF NOT EXISTS status          VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE arena_agents ADD COLUMN IF NOT EXISTS validation_error TEXT;
ALTER TABLE arena_agents ADD COLUMN IF NOT EXISTS error_matches   INT NOT NULL DEFAULT 0;

-- Cập nhật agent cũ từ is_active=true thành status='active'
UPDATE arena_agents SET status = 'active' WHERE is_active = true AND status = 'pending';

CREATE INDEX IF NOT EXISTS arena_agents_user_id_idx  ON arena_agents(user_id);
CREATE INDEX IF NOT EXISTS arena_agents_elo_idx      ON arena_agents(elo DESC);
CREATE INDEX IF NOT EXISTS arena_agents_status_idx   ON arena_agents(status);

-- ─── 2. tournament_sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         VARCHAR(100) NOT NULL DEFAULT '',
  -- idle | running | paused | stopped | completed
  status       VARCHAR(20) NOT NULL DEFAULT 'idle',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  -- Config lưu dạng JSON: { max_parallel_matches, new_agent_policy, allow_rematch, max_moves }
  config       JSONB NOT NULL DEFAULT '{"max_parallel_matches":3,"new_agent_policy":"exclude","allow_rematch":false,"max_moves":300}',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  paused_at    TIMESTAMPTZ,
  resumed_at   TIMESTAMPTZ,
  stopped_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tournament_sessions_status_idx     ON tournament_sessions(status);
CREATE INDEX IF NOT EXISTS tournament_sessions_created_at_idx ON tournament_sessions(created_at DESC);

-- ─── 3. tournament_matches ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_matches (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id       BIGINT NOT NULL REFERENCES tournament_sessions(id) ON DELETE CASCADE,
  agent1_id        BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,
  agent2_id        BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,
  -- ID trả về từ FastAPI backend (in-memory)
  backend_match_id VARCHAR(50),
  -- scheduled | running | finished | error | cancelled
  status           VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  -- agent1 | agent2 | draw | NULL (chưa xong)
  outcome          VARCHAR(10),
  winner_agent_id  BIGINT REFERENCES arena_agents(id) ON DELETE SET NULL,
  -- true = lỗi hạ tầng (Judge0/timeout), KHÔNG tính vào ELO
  is_infra_error   BOOLEAN NOT NULL DEFAULT false,
  infra_error_detail TEXT,
  win_reason       TEXT NOT NULL DEFAULT '',
  total_moves      INT NOT NULL DEFAULT 0,
  elo_delta_agent1 INT,   -- ELO thay đổi của agent1 (NULL nếu infra error)
  elo_delta_agent2 INT,
  scheduled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  -- Ngăn trùng cặp trong cùng session
  CONSTRAINT uq_session_pair UNIQUE (session_id, agent1_id, agent2_id),
  CONSTRAINT chk_diff_agents CHECK (agent1_id != agent2_id)
);

CREATE INDEX IF NOT EXISTS tm_session_idx      ON tournament_matches(session_id);
CREATE INDEX IF NOT EXISTS tm_agent1_idx       ON tournament_matches(agent1_id);
CREATE INDEX IF NOT EXISTS tm_agent2_idx       ON tournament_matches(agent2_id);
CREATE INDEX IF NOT EXISTS tm_status_idx       ON tournament_matches(status);
CREATE INDEX IF NOT EXISTS tm_session_status   ON tournament_matches(session_id, status);
CREATE INDEX IF NOT EXISTS tm_scheduled_at_idx ON tournament_matches(scheduled_at DESC);

-- ─── 4. match_move_history ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_move_history (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id       BIGINT NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  move_number    INT NOT NULL,
  player         INT NOT NULL,   -- 1 hoặc 2
  from_col       INT NOT NULL,
  from_row       INT NOT NULL,
  to_col         INT NOT NULL,
  to_row         INT NOT NULL,
  from_pos       VARCHAR(3) NOT NULL,
  to_pos         VARCHAR(3) NOT NULL,
  piece_type     VARCHAR(10),
  captured_type  VARCHAR(10),    -- NULL nếu không ăn quân
  UNIQUE (match_id, move_number)
);

CREATE INDEX IF NOT EXISTS mmh_match_id_idx ON match_move_history(match_id);

-- ─── 5. friendly_matches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendly_matches (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  agent1_id        BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,
  agent2_id        BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,
  backend_match_id VARCHAR(50),
  -- scheduled | running | finished | error
  status           VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  outcome          VARCHAR(10),   -- agent1 | agent2 | draw | NULL
  winner_agent_id  BIGINT REFERENCES arena_agents(id) ON DELETE SET NULL,
  win_reason       TEXT NOT NULL DEFAULT '',
  total_moves      INT NOT NULL DEFAULT 0,
  is_infra_error   BOOLEAN NOT NULL DEFAULT false,
  is_public        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  CONSTRAINT chk_friendly_diff CHECK (agent1_id != agent2_id)
);

CREATE INDEX IF NOT EXISTS fm_created_by_idx ON friendly_matches(created_by);
CREATE INDEX IF NOT EXISTS fm_agent1_idx     ON friendly_matches(agent1_id);
CREATE INDEX IF NOT EXISTS fm_agent2_idx     ON friendly_matches(agent2_id);
CREATE INDEX IF NOT EXISTS fm_created_at_idx ON friendly_matches(created_at DESC);

-- ─── 6. friendly_match_history ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendly_match_history (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  friendly_match_id BIGINT NOT NULL REFERENCES friendly_matches(id) ON DELETE CASCADE,
  move_number    INT NOT NULL,
  player         INT NOT NULL,
  from_col       INT NOT NULL,
  from_row       INT NOT NULL,
  to_col         INT NOT NULL,
  to_row         INT NOT NULL,
  from_pos       VARCHAR(3) NOT NULL,
  to_pos         VARCHAR(3) NOT NULL,
  piece_type     VARCHAR(10),
  captured_type  VARCHAR(10),
  UNIQUE (friendly_match_id, move_number)
);

CREATE INDEX IF NOT EXISTS fmh_match_id_idx ON friendly_match_history(friendly_match_id);
