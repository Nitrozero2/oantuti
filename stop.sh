#!/usr/bin/env bash
# =============================================================================
# stop.sh — Dừng toàn bộ stack OTTv2
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
JUDGE0_DIR="$SCRIPT_DIR/judge0"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# Dừng Frontend
if [ -f "$LOG_DIR/frontend.pid" ]; then
  PID=$(cat "$LOG_DIR/frontend.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    info "Frontend (PID $PID) đã dừng."
  else
    warn "Frontend PID $PID không còn chạy."
  fi
  rm -f "$LOG_DIR/frontend.pid"
else
  # Fallback: kill by port
  PID=$(lsof -ti :3000 2>/dev/null || true)
  [ -n "$PID" ] && kill "$PID" && info "Frontend (port 3000) đã dừng."
fi

# Dừng Backend
if [ -f "$LOG_DIR/backend.pid" ]; then
  PID=$(cat "$LOG_DIR/backend.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    info "Backend (PID $PID) đã dừng."
  else
    warn "Backend PID $PID không còn chạy."
  fi
  rm -f "$LOG_DIR/backend.pid"
else
  PID=$(lsof -ti :8000 2>/dev/null || true)
  [ -n "$PID" ] && kill "$PID" && info "Backend (port 8000) đã dừng."
fi

# Dừng Judge0 (Docker)
if [ -d "$JUDGE0_DIR" ]; then
  read -p "Dừng Judge0 Docker containers? (y/N): " CONFIRM
  if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    cd "$JUDGE0_DIR"
    docker compose down
    info "Judge0 đã dừng."
  else
    info "Judge0 vẫn đang chạy (bỏ qua)."
  fi
fi

echo ""
info "Đã dừng xong."
