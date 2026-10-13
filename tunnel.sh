#!/usr/bin/env bash
# =============================================================================
# tunnel.sh — Bật backend (Judge0 + FastAPI) + Cloudflare Quick Tunnel
#
# Dùng khi muốn cho Vercel frontend gọi được backend máy cá nhân.
# Không cần domain riêng — dùng Quick Tunnel (URL tạm, đổi mỗi lần bật).
#
# Sau khi chạy:
#   1. Copy URL tunnel (dạng https://xxxx.trycloudflare.com)
#   2. Paste vào Vercel → Project Settings → Environment Variables → BACKEND_URL
#   3. Redeploy Vercel (hoặc chờ ~30s nếu dùng preview deploy)
#
# Để dừng: Ctrl+C
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
JUDGE0_DIR="$SCRIPT_DIR/judge0"
LOG_DIR="$SCRIPT_DIR/logs"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()    { echo -e "${CYAN}[STEP]${NC}  $*"; }
success() { echo -e "${BOLD}${GREEN}$*${NC}"; }
err()     { echo -e "${RED}[ERR]${NC}   $*" >&2; }

mkdir -p "$LOG_DIR"

# ─── Cleanup khi Ctrl+C ──────────────────────────────────────────────────────
cleanup() {
  echo ""
  warn "Đang dừng..."

  # Dừng cloudflared
  if [ -n "${TUNNEL_PID:-}" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null
    info "  Tunnel đã dừng."
  fi

  # Dừng backend
  if [ -f "$LOG_DIR/backend.pid" ]; then
    BPID=$(cat "$LOG_DIR/backend.pid" 2>/dev/null)
    if [ -n "$BPID" ] && kill -0 "$BPID" 2>/dev/null; then
      kill "$BPID" 2>/dev/null
      rm -f "$LOG_DIR/backend.pid"
      info "  Backend đã dừng."
    fi
  fi

  echo ""
  warn "Nhớ cập nhật BACKEND_URL trên Vercel về placeholder hoặc URL mới lần sau."
  echo ""
  exit 0
}
trap cleanup INT TERM

# ─── Kiểm tra cloudflared ────────────────────────────────────────────────────
if ! command -v cloudflared >/dev/null 2>&1; then
  err "cloudflared chưa được cài. Cài bằng lệnh:"
  echo ""
  echo "  # Linux x86_64:"
  echo "  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \\"
  echo "       -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared"
  echo ""
  exit 1
fi

# ─── Bước 1: Judge0 ──────────────────────────────────────────────────────────
step "1/3 Kiểm tra Judge0..."

if [ ! -d "$JUDGE0_DIR" ]; then
  warn "  Không tìm thấy thư mục judge0/. Bỏ qua — agent sẽ không chạy được."
else
  if curl -sf http://localhost:2358/about >/dev/null 2>&1; then
    info "  ✅ Judge0 đang chạy tại http://localhost:2358"
  else
    info "  Khởi động Judge0..."
    cd "$JUDGE0_DIR"
    docker compose up -d db redis 2>&1 | tail -2
    info "  Chờ DB + Redis sẵn sàng (15s)..."
    sleep 15
    docker compose up -d 2>&1 | tail -3
    info "  Chờ Judge0 worker (20s)..."
    sleep 20

    if curl -sf http://localhost:2358/about >/dev/null 2>&1; then
      info "  ✅ Judge0 sẵn sàng"
    else
      warn "  ⚠️  Judge0 chưa phản hồi. Kiểm tra: docker compose -f judge0/docker-compose.yml logs"
    fi
    cd "$SCRIPT_DIR"
  fi
fi

# ─── Bước 2: FastAPI Backend ─────────────────────────────────────────────────
step "2/3 Khởi động FastAPI backend..."

# Dừng process cũ trên port 8000 nếu có
OLD_PID=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  warn "  Port 8000 đang bị chiếm (PID $OLD_PID), đang kill..."
  kill "$OLD_PID" 2>/dev/null || true
  sleep 1
fi

if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
  err "Chưa có virtualenv. Chạy ./setup.sh trước."
  exit 1
fi

cd "$BACKEND_DIR"
source venv/bin/activate
nohup uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  >> "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$LOG_DIR/backend.pid"
deactivate
cd "$SCRIPT_DIR"

# Chờ backend sẵn sàng (tối đa 10s)
BACKEND_READY=0
for i in $(seq 1 10); do
  sleep 1
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    BACKEND_READY=1
    break
  fi
done

if [ "$BACKEND_READY" -eq 1 ]; then
  info "  ✅ Backend sẵn sàng (PID $BACKEND_PID) → http://localhost:8000"
else
  warn "  ⚠️  Backend chưa phản hồi sau 10s. Kiểm tra: tail -f $LOG_DIR/backend.log"
fi

# ─── Bước 3: Cloudflare Quick Tunnel ─────────────────────────────────────────
step "3/3 Mở Cloudflare Quick Tunnel..."
info "  Đang kết nối đến Cloudflare... (5-15s)"

TUNNEL_LOG="$LOG_DIR/tunnel.log"
> "$TUNNEL_LOG"  # clear log cũ

# Chạy cloudflared nền, ghi stderr (chứa URL) ra file
cloudflared tunnel --url http://localhost:8000 \
  --no-autoupdate \
  2>"$TUNNEL_LOG" &
TUNNEL_PID=$!

# Đợi URL xuất hiện trong log (tối đa 30s)
TUNNEL_URL=""
for i in $(seq 1 30); do
  sleep 1
  # URL có dạng: https://xxxx-xxxx-xxxx.trycloudflare.com
  TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
done

if [ -z "$TUNNEL_URL" ]; then
  err "Không lấy được URL tunnel sau 30s."
  err "Xem log: cat $TUNNEL_LOG"
  # Thử lấy bất kỳ URL https nào
  TUNNEL_URL=$(grep -oP 'https://[^\s]+trycloudflare[^\s]+' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    warn "Tìm thấy URL (có thể không chuẩn): $TUNNEL_URL"
  else
    cleanup
    exit 1
  fi
fi

# ─── Hiện kết quả ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ Backend + Tunnel sẵn sàng!${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ⚙️  Backend local  →  http://localhost:8000/docs"
echo -e "  🔧 Judge0          →  http://localhost:2358/about"
echo ""
echo -e "${BOLD}  🌐 Tunnel URL (copy cái này):${NC}"
echo ""
echo -e "  ${BOLD}${CYAN}${TUNNEL_URL}${NC}"
echo ""
echo -e "${BOLD}${YELLOW}  👉 Bước tiếp theo:${NC}"
echo    "     1. Vào Vercel → Project Settings → Environment Variables"
echo    "     2. Sửa BACKEND_URL = ${TUNNEL_URL}"
echo    "     3. Redeploy (hoặc push 1 commit nhỏ bất kỳ)"
echo ""
echo    "  Logs:"
echo    "    Backend: tail -f $LOG_DIR/backend.log"
echo    "    Tunnel:  tail -f $LOG_DIR/tunnel.log"
echo ""
echo -e "${YELLOW}  Nhấn Ctrl+C để dừng tất cả.${NC}"
echo ""

# ─── Giữ script chạy, in health check mỗi 30s ───────────────────────────────
while true; do
  sleep 30

  # Kiểm tra tunnel còn sống không
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    err "Tunnel bị ngắt! Khởi động lại tunnel.sh để lấy URL mới."
    break
  fi

  # Kiểm tra backend còn sống không
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    warn "Backend bị crash. Xem log: tail -f $LOG_DIR/backend.log"
    warn "Tự restart backend..."
    cd "$BACKEND_DIR"
    source venv/bin/activate
    nohup uvicorn app.main:app \
      --host 0.0.0.0 \
      --port 8000 \
      >> "$LOG_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > "$LOG_DIR/backend.pid"
    deactivate
    cd "$SCRIPT_DIR"
    info "Backend đã restart (PID $BACKEND_PID)"
  fi
done

cleanup
