-- =============================================================================
-- friendly_challenge_migration.sql
-- Chạy trong Neon SQL Editor để thêm hệ thống thách đấu
-- =============================================================================

-- ─── 1. Thêm cột status mở rộng cho friendly_matches ─────────────────────────
-- status mới: 'pending_backend' = accepted nhưng chờ backend online để chạy
ALTER TABLE friendly_matches ADD COLUMN IF NOT EXISTS pending_backend BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE friendly_matches ADD COLUMN IF NOT EXISTS challenger_id  BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE friendly_matches ADD COLUMN IF NOT EXISTS opponent_id    BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fm_pending_backend_idx ON friendly_matches(pending_backend) WHERE pending_backend = true;

-- ─── 2. Bảng friendly_challenges ─────────────────────────────────────────────
-- Lưu lời thách đấu giữa 2 user
CREATE TABLE IF NOT EXISTS friendly_challenges (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Người gửi thách đấu
  challenger_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Agent của challenger muốn dùng
  challenger_agent_id BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,

  -- Người nhận thách đấu
  opponent_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Agent của opponent mà challenger muốn đấu với
  opponent_agent_id BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,

  -- pending | accepted | declined | cancelled | expired
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- Tin nhắn tùy chọn kèm thách đấu
  message          TEXT NOT NULL DEFAULT '',

  -- Nếu accepted → friendly_match_id trỏ tới trận đấu tạo ra
  friendly_match_id BIGINT REFERENCES friendly_matches(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),

  CONSTRAINT chk_challenge_diff_users CHECK (challenger_id != opponent_id),
  CONSTRAINT chk_challenge_diff_agents CHECK (challenger_agent_id != opponent_agent_id)
);

CREATE INDEX IF NOT EXISTS fc_challenger_idx  ON friendly_challenges(challenger_id);
CREATE INDEX IF NOT EXISTS fc_opponent_idx    ON friendly_challenges(opponent_id);
CREATE INDEX IF NOT EXISTS fc_status_idx      ON friendly_challenges(status);
CREATE INDEX IF NOT EXISTS fc_created_at_idx  ON friendly_challenges(created_at DESC);
-- Index để query "challenges chưa xử lý của user"
CREATE INDEX IF NOT EXISTS fc_opponent_pending_idx
  ON friendly_challenges(opponent_id, status)
  WHERE status = 'pending';
