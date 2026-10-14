#!/usr/bin/env bash
# =============================================================================
# setup.sh — Cài đặt OTTv2 (Judge0 + Backend + Worker + Frontend)
# Chạy 1 lần duy nhất trên máy mới.
#
# Kiến trúc:
#   Frontend (Vercel) ←→ FastAPI (Vercel) ←→ Redis (Upstash) ←→ Worker (máy này)
#                                                                      ↓
#                                                                  Judge0 (Docker)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
WORKER_DIR="$SCRIPT_DIR/worker"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()  { echo -e "${CYAN}[STEP]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       OTTv2 Setup Script             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── 1. Kiểm tra dependencies ──────────────────────────────────────────────────
step "1/5 Kiểm tra dependencies..."
command -v docker   >/dev/null 2>&1 || error "Docker chưa cài. Xem: https://docs.docker.com/engine/install/ubuntu/"
command -v python3  >/dev/null 2>&1 || error "Python 3 chưa cài."
command -v pip3     >/dev/null 2>&1 || error "pip3 chưa cài."
command -v node     >/dev/null 2>&1 || warn "Node.js chưa cài — cần nếu chạy frontend local."
info "  Docker:  $(docker --version | head -1)"
info "  Python:  $(python3 --version)"
command -v node >/dev/null 2>&1 && info "  Node:    $(node --version)"

# ── 2. Backend: virtualenv + pip ─────────────────────────────────────────────
step "2/5 Cài đặt backend dependencies..."
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

# Backend .env
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  warn "  Đã tạo backend/.env — hãy điền UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, WORKER_SECRET!"
else
  info "  backend/.env đã tồn tại."
fi

# ── 3. Worker: virtualenv + pip ───────────────────────────────────────────────
step "3/5 Cài đặt worker dependencies..."
cd "$WORKER_DIR"
if [ ! -d "venv" ]; then
  python3 -m venv venv
  info "  Đã tạo worker virtualenv."
fi
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
deactivate
info "  Worker dependencies OK."

# Worker .env
if [ ! -f "$WORKER_DIR/.env" ]; then
  cp "$WORKER_DIR/.env.example" "$WORKER_DIR/.env"
  warn "  Đã tạo worker/.env — hãy điền BACKEND_URL và WORKER_SECRET!"
else
  info "  worker/.env đã tồn tại."
fi

# ── 4. Frontend: npm install ──────────────────────────────────────────────────
step "4/5 Cài đặt frontend dependencies..."
if command -v node >/dev/null 2>&1; then
  cd "$FRONTEND_DIR"
  npm install --silent
  info "  Frontend dependencies OK."

  if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
    if [ -f "$FRONTEND_DIR/.env.example" ]; then
      cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env.local"
      warn "  Đã tạo Frontend/.env.local — hãy điền DATABASE_URL, SESSION_SECRET, BACKEND_URL!"
    fi
  else
    info "  Frontend/.env.local đã tồn tại."
  fi
else
  warn "  Node.js không có — bỏ qua frontend."
fi

# ── 5. Judge0 ─────────────────────────────────────────────────────────────────
step "5/5 Kiểm tra Judge0..."
JUDGE0_DIR="$SCRIPT_DIR/judge0"
if [ ! -d "$JUDGE0_DIR" ]; then
  info "  Tải Judge0 CE v1.13.1..."
  mkdir -p "$JUDGE0_DIR"
  cd "$JUDGE0_DIR"
  if command -v wget >/dev/null 2>&1; then
    wget -q "https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip" -O judge0.zip
  else
    curl -sL "https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip" -o judge0.zip
  fi
  unzip -q judge0.zip
  mv judge0-v1.13.1/* .
  rm -f judge0.zip
  rmdir judge0-v1.13.1 2>/dev/null || true
  REDIS_PASS=$(openssl rand -hex 32)
  POSTGRES_PASS=$(openssl rand -hex 32)
  echo "REDIS_PASSWORD=$REDIS_PASS"       >> judge0.conf
  echo "POSTGRES_PASSWORD=$POSTGRES_PASS" >> judge0.conf
  info "  Judge0 đã tải về."
else
  info "  Thư mục judge0/ đã tồn tại."
fi

# ── Tóm tắt ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✅ Setup hoàn tất!${NC}"
echo ""
echo "  Tiếp theo — điền các biến môi trường:"
echo ""
echo "  📄 backend/.env"
echo "     UPSTASH_REDIS_REST_URL=https://..."
echo "     UPSTASH_REDIS_REST_TOKEN=..."
echo "     WORKER_SECRET=<chuỗi ngẫu nhiên>"
echo ""
echo "  📄 worker/.env"
echo "     BACKEND_URL=http://localhost:8000   (local test)"
echo "     WORKER_SECRET=<giống với backend>"
echo ""
echo "  📄 Frontend/.env.local"
echo "     DATABASE_URL=postgresql://..."
echo "     SESSION_SECRET=..."
echo "     BACKEND_URL=http://localhost:8000   (local test)"
echo ""
echo "  Sau khi điền xong:"
echo "    ./start.sh   — khởi động toàn bộ"
echo "    ./dev.sh     — chạy dev mode (hot-reload)"
echo ""
