#!/usr/bin/env bash
# =============================================================================
# tunnel.sh — ĐÃ KHÔNG CÒN DÙNG
#
# Kiến trúc cũ: FastAPI local → Cloudflare Tunnel → Vercel frontend
# Kiến trúc mới: FastAPI trên Vercel ←→ Redis (Upstash) ←→ Worker (máy này)
#
# Script này được giữ lại để tham khảo. Không cần chạy nữa.
# Xem DEPLOY.md để biết cách deploy kiến trúc mới.
# =============================================================================
echo "tunnel.sh không còn được dùng trong kiến trúc mới."
echo "Xem DEPLOY.md để biết cách deploy FastAPI lên Vercel + chạy Worker."
echo ""
echo "Tóm tắt kiến trúc mới:"
echo "  1. FastAPI deploy lên Vercel (không cần chạy local)"
echo "  2. Worker chạy trên máy này, kết nối Redis (Upstash)"
echo "  3. Worker gọi Judge0 local, không cần mở port ra ngoài"
echo ""
echo "Để chạy worker: cd worker && python worker.py"
