# Neon Vercel Auth (demo)

Website đăng ký / đăng nhập bằng Next.js, Neon PostgreSQL, bcryptjs và cookie session có chữ ký.

## 1. Chuẩn bị Neon
1. Tạo project tại https://console.neon.tech/
2. Mở SQL Editor, chạy nội dung `database.sql`.
3. Trong Neon, chọn **Connect** và sao chép connection string. Giữ `sslmode=require` nếu có.

## 2. Chạy trên máy Ubuntu
Cần Node.js 20.9 trở lên và npm.

```bash
unzip neon-vercel-auth.zip
cd neon-vercel-auth
npm install
cp .env.example .env.local
```

Sửa `.env.local`:
- `DATABASE_URL`: connection string Neon.
- `SESSION_SECRET`: chuỗi ngẫu nhiên dài ít nhất 32 ký tự. Có thể tạo bằng `openssl rand -base64 32`.

Sau đó chạy:

```bash
npm run dev
```

Mở http://localhost:3000

## 3. Deploy lên Vercel
1. Đẩy thư mục này lên GitHub (không commit `.env.local`).
2. Vào https://vercel.com/new và import repository.
3. Trong Project Settings → Environment Variables, thêm `DATABASE_URL` và `SESSION_SECRET` cho Production (có thể thêm Preview/Development nếu cần).
4. Deploy hoặc redeploy sau khi thêm biến môi trường.

Tài liệu Vercel về biến môi trường: https://vercel.com/docs/environment-variables

## Chuyển sang TrueSkill

Sau khi đã chạy `tournament_schema.sql`, mở Neon SQL Editor và chạy toàn bộ
`trueskill_migration.sql`. Cấu hình `RATING_DISPATCH_SECRET` trên frontend với
cùng giá trị `WORKER_SECRET` của backend và worker, rồi redeploy frontend.

Lần đầu chuyển dữ liệu, scheduler sẽ giữ trạng thái tắt. Admin mở `/admin/rating`
và chọn **Dựng lại từ lịch sử**. Thao tác này phát lại các trận tournament hợp lệ
theo thời gian để khởi tạo `μ`, `σ`, rating hiện tại và bật queue sau cùng.

## Ghi chú bảo mật
- Mật khẩu được hash bằng bcrypt, không lưu mật khẩu gốc.
- Session dùng cookie `HttpOnly`, `SameSite=Lax`, và `Secure` trong production.
- Đây là starter/demo. Trước khi dùng cho hệ thống công khai cần thêm rate limiting chống brute-force, xác minh email, quy trình quên mật khẩu, giám sát và chính sách bảo mật phù hợp.
