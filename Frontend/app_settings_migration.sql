-- =============================================================================
-- app_settings migration
-- Chạy trong Neon SQL Editor (1 lần duy nhất)
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by BIGINT       REFERENCES users(id) ON DELETE SET NULL
);

-- Seed giá trị mặc định cho backend_url
-- Sau khi bật tunnel.sh, admin vào dashboard cập nhật URL thực
INSERT INTO app_settings (key, value)
VALUES ('backend_url', '')
ON CONFLICT (key) DO NOTHING;
