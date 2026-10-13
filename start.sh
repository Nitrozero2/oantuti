#!/usr/bin/env bash
# =============================================================================
# start.sh — Khởi động toàn bộ stack OTTv2
#   - Judge0   → http://localhost:2358
#   - Backend  → http://localhost:8000
#   - Frontend → http://localhost:3000
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"
JUDGE0_DIR="$SCRIPT_DIR/judge0"
LOG_DIR="$SCRIPT_DIR/logs"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()  { echo -e "${CYAN}[STEP]${NC}  $*"; }

mkdir -p "$LOG_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Judge0
# ─────────────────────────────────────────────────────────────────────────────
step "1/3 Khởi động Judge0..."

if [ ! -d "$JUDGE0_DIR" ]; then
  warn "Chưa cài Judge0. Chạy ./setup.sh trước."
  warn "Bỏ qua Judge0 — backend sẽ không thực thi agent code."
else
  cd "$JUDGE0_DIR"

  # Kiểm tra Judge0 đã chạy chưa
  if curl -sf http://localhost:2358/about >/dev/null 2>&1; then
    info "  Judge0 đang chạy tại http://localhost:2358"
  else
    info "  Khởi động Judge0 containers..."
    docker compose up -d db redis 2>&1 | tail -3
    info "  Chờ DB + Redis sẵn sàng (15s)..."
    sleep 15
    docker compose up -d 2>&1 | tail -5
    info "  Chờ Judge0 worker khởi động (20s)..."
    sleep 20

    if curl -sf http://localhost:2358/about >/dev/null 2>&1; then
      info "  ✅ Judge0 sẵn sàng tại http://localhost:2358"
    else
      warn "  ⚠️  Judge0 chưa phản hồi. Kiểm tra: docker compose -f $JUDGE0_DIR/docker-compose.yml logs"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Backend (FastAPI)
# ─────────────────────────────────────────────────────────────────────────────
step "2/3 Khởi động FastAPI backend..."

# Kill process cũ trên port 8000 nếu có
OLD_PID=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  warn "  Có process đang dùng port 8000 (PID $OLD_PID), kill..."
  kill "$OLD_PID" 2>/dev/null || true
  sleep 1
fi

if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
  warn "  Chưa có virtualenv. Chạy ./setup.sh trước."
else
  cd "$BACKEND_DIR"
  source venv/bin/activate
  nohup uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 2 \
    >> "$LOG_DIR/backend.log" 2>&1 &
  BACKEND_PID=$!
  echo $BACKEND_PID > "$LOG_DIR/backend.pid"
  deactivate

  sleep 2
  if kill -0 $BACKEND_PID 2>/dev/null; then
    info "  ✅ Backend chạy (PID $BACKEND_PID) → http://localhost:8000"
    info "     Swagger UI: http://localhost:8000/docs"
  else
    warn "  ⚠️  Backend không khởi động được. Xem log: $LOG_DIR/backend.log"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Frontend (Next.js)
# ─────────────────────────────────────────────────────────────────────────────
step "3/3 Khởi động Next.js frontend..."

# Kill process cũ trên port 3000 nếu có
OLD_PID=$(lsof -ti :3000 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  warn "  Có process đang dùng port 3000 (PID $OLD_PID), kill..."
  kill "$OLD_PID" 2>/dev/null || true
  sleep 1
fi

cd "$FRONTEND_DIR"

# Build nếu chưa có hoặc source thay đổi
if [ ! -d ".next/server" ]; then
  info "  Build frontend lần đầu (mất ~30s)..."
  npm run build >> "$LOG_DIR/frontend-build.log" 2>&1
fi

nohup npm start \
  -- --port 3000 \
  >> "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$LOG_DIR/frontend.pid"

sleep 3
if kill -0 $FRONTEND_PID 2>/dev/null; then
  info "  ✅ Frontend chạy (PID $FRONTEND_PID) → http://localhost:3000"
else
  warn "  ⚠️  Frontend không khởi động được. Xem log: $LOG_DIR/frontend.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Tóm tắt
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  OTTv2 đang chạy!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "  🌐 Frontend  →  http://localhost:3000"
echo "  ⚙️  Backend   →  http://localhost:8000/docs"
echo "  🔧 Judge0    →  http://localhost:2358/about"
echo ""
echo "  Logs:"
echo "    tail -f $LOG_DIR/backend.log"
echo "    tail -f $LOG_DIR/frontend.log"
echo ""
echo "  Để dừng: ./stop.sh"
echo ""
