#!/usr/bin/env bash
# =============================================================================
# setup.sh — Cài đặt toàn bộ OTTv2 (Judge0 + Backend + Frontend)
# Chạy 1 lần duy nhất trên máy mới.
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 1. Kiểm tra dependencies ──────────────────────────────────────────────────
info "Kiểm tra dependencies..."
command -v docker   >/dev/null 2>&1 || error "Docker chưa cài. Xem: https://docs.docker.com/engine/install/ubuntu/"
command -v node     >/dev/null 2>&1 || error "Node.js chưa cài."
command -v python3  >/dev/null 2>&1 || error "Python 3 chưa cài."
command -v pip3     >/dev/null 2>&1 || error "pip3 chưa cài."
info "  Docker: $(docker --version)"
info "  Node:   $(node --version)"
info "  Python: $(python3 --version)"

# ── 2. Backend: virtualenv + pip ─────────────────────────────────────────────
info "Cài đặt Python dependencies cho backend..."
cd "$BACKEND_DIR"

if [ ! -d "venv" ]; then
  python3 -m venv venv
  info "  Đã tạo virtualenv."
fi

source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
deactivate
info "  Backend dependencies OK."

# ── 3. Backend: tạo .env nếu chưa có ─────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  info "  Đã tạo backend/.env từ .env.example."
else
  info "  backend/.env đã tồn tại, giữ nguyên."
fi

# ── 4. Frontend: npm install ──────────────────────────────────────────────────
info "Cài đặt Node dependencies cho frontend..."
cd "$FRONTEND_DIR"
npm install --silent
info "  Frontend dependencies OK."

# ── 5. Frontend: kiểm tra .env.local ─────────────────────────────────────────
if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
  if [ -f "$FRONTEND_DIR/.env.example" ]; then
    cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env.local"
    warn "  Đã tạo Frontend/.env.local từ .env.example."
    warn "  ⚠️  Hãy điền DATABASE_URL và SESSION_SECRET vào Frontend/.env.local!"
  fi
else
  info "  Frontend/.env.local đã tồn tại."
fi

# ── 6. Judge0: download docker-compose ───────────────────────────────────────
JUDGE0_DIR="$SCRIPT_DIR/judge0"
if [ ! -d "$JUDGE0_DIR" ]; then
  info "Tải Judge0 CE v1.13.1..."
  mkdir -p "$JUDGE0_DIR"
  cd "$JUDGE0_DIR"

  if command -v wget >/dev/null 2>&1; then
    wget -q "https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip" -O judge0.zip
  elif command -v curl >/dev/null 2>&1; then
    curl -sL "https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip" -o judge0.zip
  else
    error "Cần wget hoặc curl để tải Judge0."
  fi

  unzip -q judge0.zip
  mv judge0-v1.13.1/* .
  rm -f judge0.zip
  rmdir judge0-v1.13.1 2>/dev/null || true

  # Sinh password ngẫu nhiên
  REDIS_PASS=$(openssl rand -hex 32)
  POSTGRES_PASS=$(openssl rand -hex 32)
  echo "REDIS_PASSWORD=$REDIS_PASS"    >> judge0.conf
  echo "POSTGRES_PASSWORD=$POSTGRES_PASS" >> judge0.conf
  info "  Judge0 đã tải về và cấu hình."
else
  info "  Thư mục judge0/ đã tồn tại, bỏ qua tải."
fi

echo ""
echo -e "${GREEN}✅ Setup hoàn tất!${NC}"
echo ""
echo "Tiếp theo:"
echo "  1. Điền DATABASE_URL và SESSION_SECRET vào Frontend/.env.local"
echo "  2. Chạy:  ./start.sh"
echo ""
