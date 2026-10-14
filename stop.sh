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

kill_by_pid_file() {
  local name="$1"
  local pid_file="$2"
  local port="$3"

  if [ -f "$pid_file" ]; then
    PID=$(cat "$pid_file" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      info "$name (PID $PID) đã dừng."
    else
      warn "$name PID $PID không còn chạy."
    fi
    rm -f "$pid_file"
  elif [ -n "$port" ]; then
    PID=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$PID" ]; then
      kill "$PID"
      info "$name (port $port) đã dừng."
    fi
  fi
}

kill_by_pid_file "Frontend" "$LOG_DIR/frontend.pid" "3000"
kill_by_pid_file "Backend"  "$LOG_DIR/backend.pid"  "8000"
kill_by_pid_file "Worker"   "$LOG_DIR/worker.pid"   ""

# Judge0 (hỏi trước vì docker down chậm)
if [ -d "$JUDGE0_DIR" ]; then
  read -rp "Dừng Judge0 Docker containers? (y/N): " CONFIRM
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
