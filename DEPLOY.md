# Hướng dẫn Deploy: Vercel (Frontend) + Cloudflare Tunnel (Backend)

## Kiến trúc tổng quan

```
Người dùng (browser)
      │
      ▼
┌─────────────────────────┐
│   Vercel (Frontend)     │  ← Always online, free tier
│   Next.js App           │
│   - Auth, DB, Leaderboard│
│   - Submit Agent        │
│   - Replay xem lại      │
└────────────┬────────────┘
             │  khi cần chạy trận
             ▼
┌─────────────────────────┐
│  Cloudflare Tunnel      │  ← Public HTTPS từ máy cá nhân
│  https://ott.domain.com │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Máy cá nhân (PC/laptop)│  ← Có thể tắt bất cứ lúc nào
│  FastAPI :8000          │
│  Judge0  :2358          │
└─────────────────────────┘
             │
             ▼
┌─────────────────────────┐
│  Neon PostgreSQL        │  ← Always online, serverless
└─────────────────────────┘
```

**Khi máy tắt:** Đăng nhập, nộp agent, bảng xếp hạng, replay vẫn hoạt động bình thường.
Chỉ "Đấu đối kháng", "Validate agent", "Tournament" bị disable với thông báo rõ ràng.

---

## Phần 1: Deploy Frontend lên Vercel

### Bước 1: Chuẩn bị repo

Push toàn bộ thư mục `Frontend/` lên GitHub (hoặc GitLab/Bitbucket):

```bash
cd /home/tuan/Oantuti
git init   # nếu chưa có git
git add Frontend/
git commit -m "Initial frontend"
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

> **Lưu ý:** Chọn `Frontend/` là thư mục gốc khi deploy trên Vercel (xem Bước 3).

### Bước 2: Tạo tài khoản Vercel

Truy cập [vercel.com](https://vercel.com) → Sign up với GitHub account.

### Bước 3: Import project

1. Vercel Dashboard → **Add New Project** → **Import Git Repository**
2. Chọn repo vừa tạo
3. **Root Directory**: đặt là `Frontend` (quan trọng — Vercel sẽ build từ đây)
4. **Framework Preset**: Next.js (tự detect)
5. Chưa nhấn Deploy — vào Bước 4 trước

### Bước 4: Cài Environment Variables trên Vercel

Trong mục **Environment Variables** của project settings (hoặc trong flow import):

| Tên biến | Giá trị | Ghi chú |
|---|---|---|
| `DATABASE_URL` | `postgresql://...neon.tech/...` | Copy từ Neon dashboard |
| `SESSION_SECRET` | chuỗi ngẫu nhiên ≥ 32 ký tự | Tạo bằng lệnh bên dưới |
| `BACKEND_URL` | `https://ott-backend.yourdomain.com` | URL Cloudflare Tunnel (Phần 2) |
| `NEXT_PUBLIC_FRONTEND_URL` | `https://your-app.vercel.app` | URL Vercel của bạn |

**Tạo SESSION_SECRET ngẫu nhiên:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Hoặc:
openssl rand -base64 32
```

> **Quan trọng:** `BACKEND_URL` là server-side only (không có `NEXT_PUBLIC_` prefix).
> Vercel gọi backend từ server → URL Cloudflare Tunnel, không phải localhost.

### Bước 5: Deploy

Nhấn **Deploy**. Vercel sẽ chạy `npm run build` và deploy tự động.

Sau đó mỗi khi push code mới lên GitHub, Vercel tự deploy lại.

### Bước 6: Chạy SQL Schema trên Neon

Nếu chưa chạy, vào Neon Dashboard → SQL Editor, chạy lần lượt:

```sql
-- 1. Bảng users + submissions
-- (nội dung file Frontend/database.sql)

-- 2. Bảng arena + tournament
-- (nội dung file Frontend/tournament_schema.sql)
```

---

## Phần 2: Expose Backend qua Cloudflare Tunnel

### Bước 1: Cài cloudflared trên máy cá nhân

**Linux:**
```bash
# Download binary
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

**Windows:** Download từ https://github.com/cloudflare/cloudflared/releases → `cloudflared-windows-amd64.exe`

### Bước 2: Đăng nhập Cloudflare

```bash
cloudflared tunnel login
# Mở browser, chọn domain của bạn (cần có domain trên Cloudflare)
```

> **Nếu chưa có domain:** Có thể dùng tính năng **Quick Tunnels** (không cần domain, nhưng URL thay đổi mỗi lần — không tiện):
> ```bash
> cloudflared tunnel --url http://localhost:8000
> # Sẽ in ra URL tạm như: https://random-word.trycloudflare.com
> ```

### Bước 3: Tạo tunnel cố định (khuyên dùng)

```bash
# Tạo tunnel với tên
cloudflared tunnel create ott-backend

# Lấy tunnel ID (ghi lại)
cloudflared tunnel list
```

### Bước 4: Tạo config file

Tạo file `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID_từ_bước_3>
credentials-file: /home/<username>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: ott-backend.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404
```

Thay `ott-backend.yourdomain.com` bằng subdomain bạn muốn dùng (phải thuộc domain đang quản lý trên Cloudflare).

### Bước 5: Tạo DNS record

```bash
cloudflared tunnel route dns ott-backend ott-backend.yourdomain.com
```

Lệnh này tự tạo CNAME record trên Cloudflare DNS.

### Bước 6: Cập nhật BACKEND_URL trên Vercel

Vào Vercel → Project Settings → Environment Variables → cập nhật:
```
BACKEND_URL = https://ott-backend.yourdomain.com
```

Redeploy Vercel để nhận env mới.

---

## Phần 3: Chạy hệ thống

### Khi muốn bật backend (máy cá nhân)

```bash
# Terminal 1: Chạy toàn bộ
cd /home/tuan/Oantuti
./start.sh

# Hoặc thủ công:
# Terminal 1 — Judge0
cd judge0 && docker compose up -d

# Terminal 2 — FastAPI backend
cd backend && source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 3 — Cloudflare Tunnel
cloudflared tunnel run ott-backend
```

### Khi muốn tắt

```bash
./stop.sh
# Hoặc Ctrl+C các terminal, rồi:
cd judge0 && docker compose down
```

### Chạy tunnel tự động khi khởi động máy (Linux systemd)

```bash
# Cài service
sudo cloudflared service install

# Bật service
sudo systemctl start cloudflared
sudo systemctl enable cloudflared  # auto-start khi reboot
```

---

## Phần 4: Kiểm tra sau khi deploy

### Kiểm tra frontend (Vercel)

```bash
# Mở browser
https://your-app.vercel.app

# Test các tính năng không cần backend (phải hoạt động dù máy tắt):
# ✅ /login  — đăng nhập
# ✅ /register — đăng ký
# ✅ /arena/leaderboard — bảng xếp hạng
# ✅ /arena/submit — nộp agent (lưu DB, chờ duyệt)
# ✅ /arena/replay/... — xem replay trận cũ
# ✅ /dashboard — trang chính
```

### Kiểm tra backend offline

```bash
# Tắt backend, vào /arena/friendly — phải thấy banner cam:
# "🔌 Máy chủ cá nhân đang offline"
# Nút "⚔️ Bắt đầu" phải bị disable (mờ)
```

### Kiểm tra khi backend online

```bash
# Bật tunnel + FastAPI + Judge0
# Truy cập https://your-app.vercel.app/api/backend-status
# Phải trả về: {"online": true}

# Test validate agent từ /admin/agents — phải hoạt động
# Test tạo trận /arena/friendly — phải chạy được
```

---

## Phần 5: Cập nhật BACKEND_URL khi tunnel URL thay đổi

Nếu dùng **Quick Tunnels** (URL tạm, thay đổi mỗi lần):

```bash
# Lấy URL mới
cloudflared tunnel --url http://localhost:8000
# Output: https://abc-xyz-123.trycloudflare.com

# Cập nhật trên Vercel
# Project Settings → Environment Variables → BACKEND_URL → sửa giá trị mới
# → Save → Redeploy
```

Với **Tunnel cố định** (có domain riêng): không cần làm gì, URL không đổi.

---

## Tóm tắt env vars cần thiết

### Vercel (Production)

```env
DATABASE_URL=postgresql://neondb_owner:...@ep-....neon.tech/neondb?sslmode=require
SESSION_SECRET=<random 32+ chars>
BACKEND_URL=https://ott-backend.yourdomain.com
NEXT_PUBLIC_FRONTEND_URL=https://your-app.vercel.app
```

### Máy cá nhân (.env.local — chỉ dùng khi dev local)

```env
DATABASE_URL=postgresql://...   # Cùng Neon DB hoặc local DB
SESSION_SECRET=<same or different secret>
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
```

### Backend (.env)

```env
JUDGE0_URL=http://localhost:2358
# Không cần thay đổi gì thêm cho Cloudflare Tunnel
# Backend lắng nghe localhost:8000, tunnel forward từ ngoài vào
```
