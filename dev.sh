#!/usr/bin/env bash
# =============================================================================
# dev.sh — Chạy development mode (có hot-reload)
# Mở 2 terminal riêng: backend + frontend
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/Frontend"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${CYAN}[STEP]${NC}  $*"; }

# Phát hiện terminal emulator
open_terminal() {
  local title="$1"
  local cmd="$2"
  if command -v gnome-terminal >/dev/null 2>&1; then
    gnome-terminal --title="$title" -- bash -c "$cmd; exec bash" &
  elif command -v xterm >/dev/null 2>&1; then
    xterm -title "$title" -e bash -c "$cmd; exec bash" &
  else
    # Fallback: chạy nền, hiện log
    info "Không tìm thấy GUI terminal. Chạy nền..."
    bash -c "$cmd" &
  fi
}

step "Khởi động Backend (dev mode)..."
open_terminal "OTTv2 Backend" \
  "cd '$BACKEND_DIR' && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

sleep 1

step "Khởi động Frontend (dev mode)..."
open_terminal "OTTv2 Frontend" \
  "cd '$FRONTEND_DIR' && npm run dev"

echo ""
echo -e "${GREEN}Dev servers đang khởi động...${NC}"
echo ""
echo "  🌐 Frontend  →  http://localhost:3000  (hot-reload)"
echo "  ⚙️  Backend   →  http://localhost:8000/docs (auto-reload)"
echo "  🔧 Judge0    →  http://localhost:2358/about"
echo ""
echo "Đảm bảo Judge0 đang chạy: cd judge0 && docker compose up -d"
echo ""
