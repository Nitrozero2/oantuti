#!/usr/bin/env bash
# =============================================================================
# setup_worker.sh — Cài đặt worker trên máy mới
#
# Yêu cầu:
#   - Python 3.10+
#   - Docker + Docker Compose (để chạy Judge0)
#   - curl, git
#
# Cách dùng:
#   1. Copy toàn bộ thư mục worker/ sang máy mới
#   2. cd worker/
#   3. chmod +x setup_worker.sh && ./setup_worker.sh
#   4. Điền .env
#   5. Khởi động Judge0: ./start_judge0.sh
#   6. Chạy worker: python3 worker.py
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()  { echo -e "${CYAN}[STEP]${NC}  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 1. Kiểm tra Python ────────────────────────────────────────────────────────
step "1. Kiểm tra Python..."
if ! command -v python3 &>/dev/null; then
  warn "Python3 không tìm thấy. Cài đặt: sudo apt install python3 python3-pip python3-venv"
  exit 1
fi
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
info "Python $PY_VER"

# ── 2. Tạo virtualenv ─────────────────────────────────────────────────────────
step "2. Tạo virtualenv..."
if [ ! -d "venv" ]; then
  python3 -m venv venv
  info "Đã tạo venv"
else
  info "venv đã tồn tại"
fi

# ── 3. Cài dependencies ───────────────────────────────────────────────────────
step "3. Cài dependencies..."
./venv/bin/pip install --quiet --upgrade pip
./venv/bin/pip install --quiet -r requirements.txt
info "Dependencies: $(cat requirements.txt | grep -v '^#' | tr '\n' ' ')"

# ── 4. Tạo .env ───────────────────────────────────────────────────────────────
step "4. Cấu hình .env..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  info "Đã tạo .env từ .env.example"
  warn "⚠️  Hãy điền các giá trị sau vào .env:"
  echo ""
  echo "   BACKEND_URL=https://your-backend.vercel.app  # hoặc http://host:8000"
  echo "   WORKER_SECRET=<cùng giá trị với backend>"
  echo "   FRONTEND_URL=https://your-frontend.vercel.app"
  echo "   WORKER_ID=$(hostname)  # tự động, có thể đổi"
  echo ""
else
  info ".env đã tồn tại"
fi

# ── 5. Kiểm tra Docker ────────────────────────────────────────────────────────
step "5. Kiểm tra Docker..."
if command -v docker &>/dev/null; then
  info "Docker: $(docker --version | head -1)"
else
  warn "Docker chưa cài. Judge0 cần Docker. Xem: https://docs.docker.com/engine/install/"
fi

# ── 6. Tạo judge0/ folder ────────────────────────────────────────────────────
step "6. Chuẩn bị Judge0..."
if [ ! -d "judge0" ]; then
  mkdir -p judge0
  # Tải judge0.conf và docker-compose.yml
  cat > judge0/docker-compose.yml << 'COMPOSE'
version: "3.9"
services:
  server:
    image: judge0/judge0:1.13.1
    volumes:
      - ./judge0.conf:/judge0.conf:ro
    ports:
      - "2358:2358"
    privileged: true
    restart: always
    depends_on:
      - db
      - redis
  workers:
    image: judge0/judge0:1.13.1
    command: ["./scripts/workers"]
    volumes:
      - ./judge0.conf:/judge0.conf:ro
    privileged: true
    restart: always
    depends_on:
      - db
      - redis
  db:
    image: postgres:13.0
    environment:
      POSTGRES_PASSWORD: "YourPasswordHere1234"
    restart: always
  redis:
    image: redis:6.0
    restart: always
COMPOSE

  cat > judge0/judge0.conf << 'CONF'
REDIS_URL=redis://redis:6379
POSTGRES_HOST=db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=YourPasswordHere1234
POSTGRES_DB=judge0
WORKERS_MAX_CONCURRENCY=4
ENABLE_WAIT_RESULT=true
CONF
  info "Tạo judge0/ folder với docker-compose.yml"
fi

# ── 7. Tạo start_judge0.sh ────────────────────────────────────────────────────
cat > start_judge0.sh << 'JUDGE0'
#!/usr/bin/env bash
cd "$(dirname "$0")/judge0"
echo "Starting Judge0..."
docker compose up -d db redis
echo "Waiting 15s for DB..."
sleep 15
docker compose up -d
echo "Waiting 20s for workers..."
sleep 20
curl -sf http://localhost:2358/about && echo "Judge0 OK" || echo "Judge0 not ready yet"
JUDGE0
chmod +x start_judge0.sh
info "Tạo start_judge0.sh"

# ── 8. Tạo run_worker.sh ──────────────────────────────────────────────────────
cat > run_worker.sh << 'RUN'
#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -f ".env" ]; then
  echo "ERROR: .env không tồn tại. Chạy setup_worker.sh trước."
  exit 1
fi
echo "Starting worker $(hostname)..."
exec ./venv/bin/python3 worker.py "$@"
RUN
chmod +x run_worker.sh
info "Tạo run_worker.sh"

echo ""
info "✅ Setup hoàn thành!"
echo ""
echo "Các bước tiếp theo:"
echo "  1. Điền .env (đặc biệt BACKEND_URL, WORKER_SECRET, FRONTEND_URL)"
echo "  2. Khởi động Judge0:  ./start_judge0.sh"
echo "  3. Chạy worker:       ./run_worker.sh"
echo "  4. Hoặc nền:          nohup ./run_worker.sh > worker.log 2>&1 &"
