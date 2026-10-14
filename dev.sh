#!/usr/bin/env bash
# =============================================================================
# dev.sh — Chạy development mode (hot-reload)
# Mở terminal riêng cho từng thành phần:
#   - Backend  (uvicorn --reload)
#   - Worker   (python worker.py)
#   - Frontend (npm run dev)
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
WORKER_DIR="$SCRIPT_DIR/worker"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${CYAN}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# Phát hiện terminal emulator
open_terminal() {
  local title="$1"
  local cmd="$2"
  if command -v gnome-terminal >/dev/null 2>&1; then
    gnome-terminal --title="$title" -- bash -c "$cmd; exec bash" &
  elif command -v xterm >/dev/null 2>&1; then
    xterm -title "$title" -e bash -c "$cmd; exec bash" &
  else
    info "Không tìm thấy GUI terminal — chạy nền..."
    bash -c "$cmd" &
  fi
}

# ── Backend ───────────────────────────────────────────────────────────────────
step "Backend..."
if lsof -iTCP:8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  info "Backend đã chạy trên port 8000, bỏ qua."
else
  if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
    warn "Backend chưa setup. Chạy ./setup.sh trước."
  else
    open_terminal "OTTv2 Backend" \
      "cd '$BACKEND_DIR' && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
    sleep 1
  fi
fi

# ── Worker ────────────────────────────────────────────────────────────────────
step "Worker..."
if [ ! -f "$WORKER_DIR/venv/bin/activate" ]; then
  warn "Worker chưa setup. Chạy ./setup.sh trước."
elif [ ! -f "$WORKER_DIR/.env" ]; then
  warn "worker/.env chưa có. Copy worker/.env.example → worker/.env rồi điền BACKEND_URL, WORKER_SECRET."
else
  open_terminal "OTTv2 Worker" \
    "cd '$WORKER_DIR' && source venv/bin/activate && python worker.py"
  sleep 1
fi

# ── Frontend ──────────────────────────────────────────────────────────────────
step "Frontend..."
open_terminal "OTTv2 Frontend" \
  "cd '$FRONTEND_DIR' && npm run dev -- -H 0.0.0.0"

# ── Tóm tắt ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Dev mode đang khởi động...${NC}"
echo ""
echo "  🌐 Frontend  →  http://localhost:3000  (hot-reload)"
echo "  ⚙️  Backend   →  http://localhost:8000/docs (auto-reload)"
echo "  🔧 Judge0    →  http://localhost:2358/about"
echo "  🤖 Worker    →  terminal riêng, poll Redis"
echo ""
warn "Đảm bảo Judge0 đang chạy: cd judge0 && docker compose up -d"
warn "Đảm bảo backend/.env có UPSTASH_REDIS_REST_URL và UPSTASH_REDIS_REST_TOKEN"
echo ""
