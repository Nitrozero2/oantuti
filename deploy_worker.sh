#!/usr/bin/env bash
# =============================================================================
# deploy_worker.sh — Deploy/cập nhật worker lên các máy remote qua SSH
#
# Cách dùng:
#   ./deploy_worker.sh user@host1 user@host2 ...
#
# Ví dụ:
#   ./deploy_worker.sh tuan@192.168.1.100 tuan@192.168.1.101
#
# Cài lần đầu (--setup):
#   ./deploy_worker.sh --setup tuan@192.168.1.100
#
# Sau khi deploy, drain worker từ frontend rồi restart đúng supervisor service.
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()  { echo -e "${CYAN}[STEP]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}   $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$SCRIPT_DIR/worker"
SETUP_MODE=false

# Parse args
HOSTS=()
for arg in "$@"; do
  if [ "$arg" = "--setup" ]; then
    SETUP_MODE=true
  else
    HOSTS+=("$arg")
  fi
done

if [ ${#HOSTS[@]} -eq 0 ]; then
  echo "Usage: $0 [--setup] user@host1 [user@host2 ...]"
  echo ""
  echo "  --setup  Cài đặt lần đầu (chạy setup_worker.sh trên remote)"
  echo ""
  echo "Files cần có trên máy host:"
  echo "  - SSH access"
  echo "  - Python 3.10+"
  echo "  - Docker (để chạy Judge0)"
  exit 1
fi

# Sync engine trước khi deploy
step "Syncing game_engine.py từ backend..."
"$SCRIPT_DIR/sync_engine.sh"

# Files cần deploy
DEPLOY_FILES=(
  "worker.py"
  "supervisor.py"
  "runtime.py"
  "game_engine.py"
  "requirements.txt"
  ".env.example"
  "setup_worker.sh"
  "run_worker.sh"
)

for HOST in "${HOSTS[@]}"; do
  echo ""
  step "═══ Deploy → $HOST ════════════════════════════"

  REMOTE_DIR="~/oantuti-worker"

  # Tạo thư mục remote
  ssh "$HOST" "mkdir -p $REMOTE_DIR" 2>/dev/null || {
    err "Không thể SSH vào $HOST"
    continue
  }

  # Copy files
  for FILE in "${DEPLOY_FILES[@]}"; do
    if [ -f "$WORKER_DIR/$FILE" ]; then
      scp -q "$WORKER_DIR/$FILE" "$HOST:$REMOTE_DIR/$FILE"
      info "Copied $FILE"
    fi
  done

  # Setup lần đầu
  if [ "$SETUP_MODE" = true ]; then
    info "Chạy setup_worker.sh..."
    ssh "$HOST" "cd $REMOTE_DIR && chmod +x setup_worker.sh run_worker.sh && ./setup_worker.sh"
  else
    # Chỉ install dependencies nếu đã có venv
    ssh "$HOST" "cd $REMOTE_DIR && [ -d venv ] && ./venv/bin/pip install -q -r requirements.txt || true"
  fi

  # Do not kill every named supervisor on the host. Operators can drain workers
  # in /admin/workers, then restart their exact service after updating files.
  info "Files updated. Drain the target worker in /admin/workers before restarting its supervisor service."
  info "Start command: ssh $HOST 'cd $REMOTE_DIR && ./run_worker.sh'"

  info "✅ $HOST done"
done

echo ""
info "Deploy hoàn thành cho ${#HOSTS[@]} host(s)."
echo ""
echo "Lưu ý:"
echo "  - Mỗi máy cần có .env riêng với WORKER_ID, JUDGE0_URL đúng"
echo "  - BACKEND_URL, WORKER_SECRET, FRONTEND_URL phải giống nhau"
echo "  - Xem logs: ssh host 'tail -f ~/oantuti-worker/worker.log'"
