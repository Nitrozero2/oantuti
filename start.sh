#!/usr/bin/env bash
# =============================================================================
# start.sh — Khởi động toàn bộ stack OTTv2 (production mode, chạy nền)
#
#   Judge0   → http://localhost:2358
#   Backend  → http://localhost:8000
#   Worker   → poll Redis queue
#   Frontend → http://localhost:3000  (nếu có)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
WORKER_DIR="$SCRIPT_DIR/worker"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"
JUDGE0_DIR="$SCRIPT_DIR/judge0"
LOG_DIR="$SCRIPT_DIR/logs"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()  { echo -e "${CYAN}[STEP]${NC}  $*"; }

mkdir -p "$LOG_DIR"

# ── 1. Judge0 ─────────────────────────────────────────────────────────────────
step "1/4 Judge0..."
if [ ! -d "$JUDGE0_DIR" ]; then
  warn "  Chưa cài Judge0. Chạy ./setup.sh trước."
else
  if curl -sf http://localhost:2358/about >/dev/null 2>&1; then
    info "  Judge0 đang chạy ✓"
  else
    info "  Khởi động Judge0..."
    cd "$JUDGE0_DIR"
    docker compose up -d db redis 2>&1 | tail -2
    info "  Chờ DB + Redis (15s)..."
    sleep 15
    docker compose up -d 2>&1 | tail -3
    info "  Chờ worker (20s)..."
    sleep 20
    if curl -sf http://localhost:2358/about >/dev/null 2>&1; then
      info "  ✅ Judge0 sẵn sàng"
    else
      warn "  ⚠️  Judge0 chưa phản hồi. Kiểm tra: docker compose -f judge0/docker-compose.yml logs"
    fi
    cd "$SCRIPT_DIR"
  fi
fi

# ── 2. Backend (FastAPI) ──────────────────────────────────────────────────────
step "2/4 Backend..."
OLD_PID=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  warn "  Port 8000 đang bị chiếm (PID $OLD_PID), kill..."
  kill "$OLD_PID" 2>/dev/null || true
  sleep 1
fi

if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
  warn "  Chưa có virtualenv. Chạy ./setup.sh trước."
else
  cd "$BACKEND_DIR"
  source venv/bin/activate
  nohup uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 \
    >> "$LOG_DIR/backend.log" 2>&1 &
  BACKEND_PID=$!
  echo $BACKEND_PID > "$LOG_DIR/backend.pid"
  deactivate
  cd "$SCRIPT_DIR"

  sleep 2
  if kill -0 $BACKEND_PID 2>/dev/null; then
    info "  ✅ Backend (PID $BACKEND_PID) → http://localhost:8000"
  else
    warn "  ⚠️  Backend không khởi động. Xem: tail -f $LOG_DIR/backend.log"
  fi
fi

# ── 3. Worker ─────────────────────────────────────────────────────────────────
step "3/4 Worker..."
if [ ! -f "$WORKER_DIR/venv/bin/activate" ]; then
  warn "  Worker chưa được cài. Chạy ./setup.sh trước."
elif [ ! -f "$WORKER_DIR/.env" ]; then
  warn "  worker/.env chưa được cấu hình. Bỏ qua."
else
  # Kill worker cũ nếu có
  if [ -f "$LOG_DIR/worker.pid" ]; then
    OLD_WPID=$(cat "$LOG_DIR/worker.pid" 2>/dev/null || true)
    if [ -n "$OLD_WPID" ] && kill -0 "$OLD_WPID" 2>/dev/null; then
      kill "$OLD_WPID" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$LOG_DIR/worker.pid"
  fi

  cd "$WORKER_DIR"
  source venv/bin/activate
  nohup python worker.py \
    >> "$LOG_DIR/worker.log" 2>&1 &
  WORKER_PID=$!
  echo $WORKER_PID > "$LOG_DIR/worker.pid"
  deactivate
  cd "$SCRIPT_DIR"

  sleep 2
  if kill -0 $WORKER_PID 2>/dev/null; then
    info "  ✅ Worker (PID $WORKER_PID) đang poll Redis"
  else
    warn "  ⚠️  Worker không khởi động. Xem: tail -f $LOG_DIR/worker.log"
  fi
fi

# ── 4. Frontend (tùy chọn) ────────────────────────────────────────────────────
step "4/4 Frontend..."
if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  warn "  Không tìm thấy Frontend. Bỏ qua."
else
  OLD_PID=$(lsof -ti :3000 2>/dev/null || true)
  if [ -n "$OLD_PID" ]; then
    warn "  Port 3000 đang bị chiếm (PID $OLD_PID), kill..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi

  cd "$FRONTEND_DIR"
  if [ ! -d ".next/server" ]; then
    info "  Build frontend lần đầu (~30s)..."
    npm run build >> "$LOG_DIR/frontend-build.log" 2>&1
  fi

  nohup npm start -- --port 3000 \
    >> "$LOG_DIR/frontend.log" 2>&1 &
  FRONTEND_PID=$!
  echo $FRONTEND_PID > "$LOG_DIR/frontend.pid"
  cd "$SCRIPT_DIR"

  sleep 3
  if kill -0 $FRONTEND_PID 2>/dev/null; then
    info "  ✅ Frontend (PID $FRONTEND_PID) → http://localhost:3000"
  else
    warn "  ⚠️  Frontend không khởi động. Xem: tail -f $LOG_DIR/frontend.log"
  fi
fi

# ── Tóm tắt ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  OTTv2 đang chạy!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "  🌐 Frontend  →  http://localhost:3000"
echo "  ⚙️  Backend   →  http://localhost:8000/docs"
echo "  🔧 Judge0    →  http://localhost:2358/about"
echo "  🤖 Worker    →  đang poll Redis (xem logs/worker.log)"
echo ""
echo "  Logs:"
echo "    tail -f $LOG_DIR/backend.log"
echo "    tail -f $LOG_DIR/worker.log"
echo "    tail -f $LOG_DIR/frontend.log"
echo ""
echo "  Để dừng: ./stop.sh"
echo ""
