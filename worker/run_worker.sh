#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -f ".env" ]; then
  echo "ERROR: .env không tồn tại. Chạy setup_worker.sh trước."
  exit 1
fi
echo "Starting worker $(hostname)..."
if [ -d "venv" ]; then
  ./venv/bin/python3 worker.py
else
  python3 worker.py
fi
