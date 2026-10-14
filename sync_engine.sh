#!/usr/bin/env bash
# sync_engine.sh — Sync game engine từ backend sang worker
# Chạy khi có thay đổi luật chơi trong backend/app/engine/game.py
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/backend/app/engine/game.py"
DST="$SCRIPT_DIR/worker/game_engine.py"

if [ ! -f "$SRC" ]; then
  echo "ERROR: $SRC không tồn tại"
  exit 1
fi

cp "$SRC" "$DST"
echo "✅ Synced game_engine.py ($(wc -l < "$DST") lines)"
echo "   Nhớ copy file mới sang tất cả worker machines!"
