-- Chạy file này trong Neon SQL Editor trước khi dùng website.

-- Bảng người dùng (đăng nhập bằng username)
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nếu bảng đã tồn tại, thêm cột is_admin (bỏ qua nếu đã có):
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Tạo tài khoản admin với password "admin".
-- Nếu user "admin" chưa tồn tại sẽ được INSERT, nếu đã tồn tại chỉ set is_admin = true.
INSERT INTO users (username, password_hash, is_admin)
VALUES (
  'admin',
  '$2b$12$0P28SsdwUCdPG7cv90wkQuUeVf8Ho7ErYRdKa1QMEErFnCWp.UjEi',
  true
)
ON CONFLICT (username) DO UPDATE SET is_admin = true;

-- Để set admin cho user đã tồn tại theo tên (ví dụ):
-- UPDATE users SET is_admin = true WHERE username = 'your_username';

-- Bảng lưu bài nộp code
CREATE TABLE IF NOT EXISTS submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_name VARCHAR(200) NOT NULL DEFAULT '',
  language VARCHAR(50) NOT NULL DEFAULT 'plaintext',
  code TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS submissions_user_id_idx ON submissions(user_id);
CREATE INDEX IF NOT EXISTS submissions_submitted_at_idx ON submissions(submitted_at DESC);
