-- OTTv2 Arena schema
-- Chạy file này trong Neon SQL Editor để thêm bảng arena

-- Bảng lưu agent code (để dự giải đấu)
CREATE TABLE IF NOT EXISTS arena_agents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Thống kê tổng hợp (cập nhật sau mỗi trận)
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  -- ELO rating (bắt đầu từ 1000)
  elo INT NOT NULL DEFAULT 1000,
  -- Phiên bản mới nhất của người dùng (true = agent hiện tại tham gia arena)
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS arena_agents_user_id_idx ON arena_agents(user_id);
CREATE INDEX IF NOT EXISTS arena_agents_elo_idx ON arena_agents(elo DESC);

-- Bảng lưu kết quả trận đấu arena
CREATE TABLE IF NOT EXISTS arena_matches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Backend match ID (UUID từ FastAPI)
  backend_match_id VARCHAR(50) NOT NULL,
  agent1_id BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,
  agent2_id BIGINT NOT NULL REFERENCES arena_agents(id) ON DELETE CASCADE,
  -- Kết quả: 1 = agent1 thắng, 2 = agent2 thắng, 0 = hòa, NULL = chưa kết thúc
  winner_agent_id BIGINT REFERENCES arena_agents(id) ON DELETE SET NULL,
  win_reason TEXT NOT NULL DEFAULT '',
  total_moves INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | running | finished | error
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS arena_matches_agent1_idx ON arena_matches(agent1_id);
CREATE INDEX IF NOT EXISTS arena_matches_agent2_idx ON arena_matches(agent2_id);
CREATE INDEX IF NOT EXISTS arena_matches_played_at_idx ON arena_matches(played_at DESC);
