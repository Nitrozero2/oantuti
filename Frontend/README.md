# Neon Vercel Auth (demo)

Website đăng ký / đăng nhập bằng Next.js, Neon PostgreSQL, bcryptjs và cookie session có chữ ký.

## Thử sức riêng tư và public agent

Giới hạn cho job mới: Validation 60 nước; Rating/Thử sức 150 nước tổng hai bên (mỗi nước là một bên di chuyển). Hết giới hạn hoặc thế cờ giống nhau với cùng bên tới lượt xuất hiện lần thứ ba thì hòa, không phân thắng thua theo số quân. Validation hòa hợp lệ vẫn được duyệt. Backend và worker chặn payload vượt giới hạn; khởi động lại worker để nạp luật lặp thế cờ và giới hạn cho job cũ còn trong queue. Không sửa lịch sử hoặc ép dừng trận đang chạy.

- `/arena/friendly` là thử sức riêng tư, không còn gửi/nhận thách đấu. Chọn agent đang hoạt động của cá nhân/team hiện tại và agent public thuộc người/team khác. Máy chủ chọn bên đi trước ngẫu nhiên; kết quả không thay đổi rating hoặc thống kê ranked.
- Chỉ người tạo trận cá nhân hoặc thành viên hiện tại của team nguồn được xem lịch sử/replay; đối thủ không được xem và không nhận thông báo. Admin giữ quyền truy cập kỹ thuật. Giao diện bàn cờ không thay đổi.
- Mỗi user có 10 lượt/ngày, đặt lại lúc 00:00 Asia/Ho_Chi_Minh, không cấp hạn mức mới khi đổi team. Trận chờ/running giữ lượt; lỗi hạ tầng và hủy trước chạy hoàn lượt. Trận thua/lỗi agent vẫn tính lượt.
- `POST /api/friendly` nhận `agent1_id` (agent nguồn), `agent2_id` (đối thủ), `request_id` UUID. Đây không phải thứ tự trên bàn cờ. Gửi lại cùng UUID trả lại trận cũ, kể cả hết lượt; backend offline vẫn lưu trận và có nút gửi lại vào queue.
- Agent mới mặc định `is_public:false`; cả public/private đều phải self-play thành công. Chỉ public tham gia rating/leaderboard và danh sách đối thủ. Public không công khai code. Agent private hợp lệ có thể public một chiều qua nút trong lịch sử; không thể chuyển ngược.
- Chặn code trùng trong toàn bộ lịch sử của scope đang nộp, không so với mã riêng của người khác. SHA-256 kèm so sánh nội dung sau chuẩn hóa xuống dòng, dòng trống ngoài cùng và khoảng trắng cuối dòng an toàn; giữ nguyên thụt lề, comment và nội dung chuỗi. Duplicate trả 409 và ID agent cũ, không thêm version/job.
- Các API challenge cũ trả 410; lịch sử friendly cũ giữ nguyên kết quả nhưng chỉ phía nguồn được xem.

Triển khai sau `teams_migration.sql`: dùng Node.js 24 chạy `node scripts/migrate-private-trials.mjs --apply` trong `Frontend`. Runner backfill hash code, giữ agent cũ public và kiểm tra bảo toàn user/code/điểm/lịch sử trong transaction; báo cáo tại `logs/private-trials-rollout.json`. Không chạy lại migration TrueSkill cũ vì có reset điểm. Nếu áp dụng lại migration scheduler/team, phải áp dụng private trials sau cùng. Migration mới không khởi động worker và không reset dữ liệu.

Kiểm thử: `npm test`, `npm run lint`, `NEXT_BUILD_DIR=.next-leaderboard-test npm run build`, rồi `node scripts/e2e-leaderboard.mjs`. E2E dùng Chrome + schema Neon tạm, backend giả offline để tránh chạm Redis thật, và dọn schema khi xong; đây không phải kiểm thử chạy engine/Judge0 thật.

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

## Kiểm thử cục bộ

Trong thư mục `Frontend`, chạy `npm test`, `npm run lint` và `npm run build`.
Test callback tích hợp dùng PostgreSQL trong bộ nhớ qua PGlite, chạy các migration SQL
của dự án và không kết nối Neon thật. Các ca kiểm thử bao gồm callback đồng thời,
rollback khi ghi replay thất bại, retry validation và chuyển quyền chạy sau khi worker crash.

Tại thư mục gốc, chạy `python3 -B -m pytest -q -p no:cacheprovider backend/tests`
sau khi cài dependencies trong `backend/requirements.txt` và `worker/requirements.txt`.
Các test Python giả lập Redis/Judge0 và kiểm tra engine, queue, worker và lease.

Khi triển khai bản sửa callback, cập nhật backend trước frontend và worker:
frontend dùng `POST /worker/tasks/verify` với `X-Internal-Secret` để xác minh delivery
trước khi chuyển execution token cho worker thay thế. Cần đã áp dụng
`execution_token_migration.sql`; bước kiểm thử không tự chạy migration trên dữ liệu thật.

### E2E với Neon, Upstash và Judge0 thật

Chạy `NEXT_BUILD_DIR=.next-e2e npm run build`, sau đó `node scripts/e2e.mjs --run` trong `Frontend`.
Script đọc `Frontend/.env.local`, `backend/.env` và `worker/.env`; Judge0 phải đang
hoạt động tại `127.0.0.1:2358`. Backend và frontend E2E dùng cổng 8100 và 3100,
tách khỏi stack mặc định 8000/3000 và thư mục build `.next`.

Script tạo schema `ott_e2e_<timestamp>` trong chính database của env và dùng namespace
Redis cùng tên, không lấy task hoặc sửa rating trong schema `public`. Nó kiểm tra
đăng nhập, phân quyền, self-play hợp lệ/lỗi, TrueSkill, thách đấu, lưu replay và các
trang frontend qua HTTP với production build. Đây chưa phải kiểm thử tương tác trình duyệt.

Sau khi chạy, ba dịch vụ được giữ online trong môi trường E2E; scheduler tính điểm
tự động được tắt để tránh chạy vô hạn. PID và thư mục log nằm trong `logs/e2e-state.json`
ở thư mục gốc. `report.json` ghi kết quả và `accounts.json` chứa tài khoản thử nghiệm,
chỉ chủ máy được đọc. Chạy `node scripts/e2e.mjs --stop` để dừng đúng các process
đã tạo và xóa schema/Redis namespace thử nghiệm; log được giữ lại.

`node scripts/e2e.mjs --verify` xác minh lại dữ liệu đã chạy, replay, callback trùng,
trạng thái worker và các trang HTTP. Script tự chọn một IP Neon có kết nối TLS hợp lệ
cho riêng tiến trình E2E, hữu ích khi một số địa chỉ DNS không truy cập được từ máy.
Không sửa DNS hệ thống, file hosts hoặc các file env. Dùng thêm `--restart-frontend`
với `--verify` nếu cần áp dụng lại tuyến này cho frontend E2E đang chạy.

### Quản lý worker

Admin mở `/admin/workers` để bật, tạm dừng/tiếp tục, dừng an toàn/dừng ngay và
đổi giới hạn job đồng thời (1–64). Supervisor vẫn online khi process xử lý dừng.
Cấu hình được giữ trong Redis; mở hai console cùng tên bị chặn. Dùng `python worker.py --name alpha`
và `--name beta` khi muốn chạy song song trên cùng máy. Xem `worker/README.md` ở thư mục gốc.

Sau E2E cơ bản, chạy `node scripts/e2e-workers.mjs` để kiểm tra giao diện bằng Chrome
headless đang cài tại `/opt/google/chrome/chrome`, concurrency khi có trận thật,
thu hồi job và chạy lại ở worker khác, crash/restart và cấu hình offline. Báo cáo và
ảnh giao diện được lưu cùng thư mục log E2E. Không chạy các thao tác kill trên stack mặc định.

Stack local mặc định: `node scripts/start-local.mjs` và kiểm tra bằng `--check`.
Muốn tự mở console dev, chạy `./dev.sh` từ thư mục gốc: chỉ mở backend và frontend,
không chạy worker. Khi cần worker, bật riêng bằng `cd worker && python3 -B worker.py`.
Để cập nhật bản build, chờ worker hết job, chạy `node scripts/start-local.mjs --stop`,
`npm run build`, rồi khởi động lại. Lệnh stop chỉ nhận các PID do script ghi nhận,
kiểm tra danh tính tiến trình và từ chối khi worker đang bận. Database vẫn dùng schema
`public`, Redis không có namespace E2E; không xóa queue hoặc dữ liệu mặc định.
Chỉ dùng thêm `--force` với `--stop` khi muốn ngắt cả job đang chạy; supervisor được
dừng trước để thu hồi job rồi mới dừng frontend/backend. Dữ liệu queue không bị xóa.

System Status kiểm tra backend qua `/health`, độc lập với API thống kê worker.
Worker có supervisor online vẫn có thể đang stopped/paused/error và không nhận job.
Queue depth là số bản ghi Redis, không nhất thiết bằng số trận scheduled nếu có task trùng.
Enqueue mới được chống trùng theo task ID trong một Lua script, kể cả khi task đang
queued hoặc còn lease xử lý. `node scripts/restart-backend.mjs` cập nhật riêng backend
local được ghi nhận, không dừng frontend hoặc worker.
Tiện ích bảo trì chỉ chạy khi đã xác minh lỗi dữ liệu:
`python -B scripts/repair_queue_duplicates.py --apply` trong `backend` loại bản sao
payload trùng hệt, giữ thứ tự và sao lưu queue trong Redis 7 ngày.
`node scripts/repair-scheduled-tokens.mjs --ids 24,25 --apply` trong `Frontend`
chỉ xóa token kẹt của các ID chỉ định đang scheduled, từ chối khi còn lease và lưu
backup riêng tư trong `logs`. Không dùng các lệnh này để bật worker đã chủ động dừng.

## Scheduler rating thích ứng

Migration mới `adaptive_rating_migration.sql` chỉ thêm cấu hình, view và hàm
PostgreSQL; không chạy lại `trueskill_migration.sql` trên dữ liệu đang sử dụng vì
migration cũ có phần reset điểm. Chạy unit/integration tests trước khi triển khai.

Mặc định: đủ 10 trận hợp lệ và σ ≤ 2,5 thì ổn định; tối đa 20 trận/agent/24 giờ
trượt, bao gồm cả lượt đã dành cho trận chờ/chạy. Agent ổn định được kiểm tra lại
mỗi 24 giờ hoặc làm đối thủ hiệu chỉnh agent mới. Các phiên bản được tính độc lập,
không đấu cùng chủ; cặp đấu nghỉ ít nhất 60 giây, tránh ba đối thủ gần nhất nếu còn
lựa chọn khác, mỗi lượt thứ năm khám phá cặp ít gặp. Bên đi trước được cân bằng
theo lịch sử. Ba lỗi hạ tầng trong một giờ dẫn tới nghỉ 15 phút; không tính lỗi vào
ngân sách hợp lệ. Các ngưỡng nằm trong `rating_scheduler_policy`.

`/admin/rating` giải thích trạng thái, ngân sách và thời điểm đánh giá tiếp. Nút
bật/tạm dừng chỉ kiểm soát dispatch rating, độc lập với rebuild; validation và
job đã enqueue vẫn chạy. Không cần lấp đầy worker nếu không có trận cần đánh giá.

Triển khai local: `node scripts/migrate-adaptive-rating.mjs --apply` lưu trạng thái
bật/tắt cũ và tạm dừng scheduler; sau khi cập nhật frontend/worker, chạy cùng script
với `--resume`. Chỉ dùng script trong `Frontend`, nhắm schema `public`. Nhật ký
rollout nằm tại `logs/adaptive-rating-rollout.json`; khi lỗi, kiểm tra nhật ký trước
khi thao tác tiếp. Có thể truyền `--neon-host` và `--neon-address` để chọn tuyến TLS
Neon cho riêng tiến trình bảo trì, không đổi env hoặc DNS hệ thống.

Kiểm thử thật: build `.next-e2e`, chạy `node scripts/e2e.mjs --run`, sau đó
`node scripts/e2e-rating.mjs`. Test concurrency dùng schema phụ thuộc riêng E2E;
Chrome kiểm tra ngân sách và bật/tạm dừng. `--retry` chỉ dựng lại fixture scheduler
của lần E2E đó. `node scripts/e2e.mjs --stop` dọn cả hai schema và namespace Redis,
giữ lại báo cáo và ảnh trong thư mục log.

## Teams và tư cách thi đấu

Nút Team cạnh khu vực đăng nhập/đăng xuất mở `/team`. Tài khoản mới vẫn thi đấu
cá nhân; không tạo team tự động. Team thật có 1–3 người. Người tạo luôn là trưởng
đội, không thể rời/bị xóa/chuyển quyền; chỉ admin tại `/admin/teams` được giải thể.
Trưởng đội mời user chưa có team bằng username, quản lý thành viên, đổi tên và
bật trạng thái tuyển đồng đội. Lời mời hết hạn sau 7 ngày và không giữ chỗ.

Khi tạo đội, agent cá nhân của trưởng đội chuyển thành tài sản chung, giữ tác giả,
rating và replay. Thành viên gia nhập giữ agent cá nhân riêng: tạm ngừng rating,
không tính vào team và không chia sẻ code. Rời/bị xóa sẽ phục hồi tư cách cá nhân,
không bật lại agent bị admin vô hiệu hóa. Agent đã nộp cho đội luôn ở lại đội.
Mọi thành viên dùng chung code/agent của đội và phản hồi thách đấu của đội.
Leaderboard có cả cá nhân và team, nhưng một user không có hai tư cách hoạt động.
Scheduler không ghép rating nội bộ; job đang chạy được hoàn thành, job chờ của
tư cách bị dừng được hủy và worker ACK terminal job mà không chạy lại.

Migration **bổ sung, không reset dữ liệu**: sau các migration hiện có, bao gồm
`adaptive_rating_migration.sql`, chạy `node scripts/migrate-teams.mjs --apply`
từ Frontend. Mặc định không có `--apply` chỉ kiểm tra trạng thái. Script khóa
ngắn trong transaction, kiểm tra fingerprint user/trận/nước đi/rating trước-sau,
lưu báo cáo `logs/teams-rollout.json`. Nếu áp dụng lại adaptive migration thì
phải áp dụng teams migration sau cùng để giữ bộ lọc tư cách của scheduler.
Không chạy lại `trueskill_migration.sql` trên dữ liệu cần giữ.

API: `GET/POST /api/team`, `GET /api/team/candidates?search=...`,
`GET /api/admin/teams`, `GET /api/arena/teams/<id>/agents`. POST team nhận action
`create/update/invite/cancel/accept/decline/leave/remove/archive`; server đọc quyền
từ database, không tin team/role do client cung cấp. Nộp agent có `expected_scope`
để phát hiện tư cách đổi từ tab khác, không vô tình chia sẻ code vào nhầm đội.

`npm test` gồm kiểm thử PostgreSQL in-memory cho concurrency, sở hữu và callback.
E2E leaderboard dưới đây bao gồm tạo/mời/gia nhập/rời/giải thể team, quyền code,
leaderboard và mobile, với tài khoản/schema tạm; không tạo team trên public.

## Leaderboard và Game History

Dashboard `/dashboard` xem được khi chưa đăng nhập. Đăng xuất thành công quay về
dashboard ở chế độ khách, không hiển thị khu vực quản trị. Navbar của khách có
đăng nhập/đăng ký; leaderboard, agent và replay vẫn công khai. Trang nộp agent và
đấu đối kháng được middleware bảo vệ trước khi render, API vẫn kiểm tra session.
Khi cần đăng nhập, `redirect` giữ trang đích và query qua cả đăng nhập lẫn đăng ký;
chỉ chấp nhận đường dẫn trang nội bộ an toàn, mặc định `/dashboard`.

`/arena/leaderboard` công khai, mỗi cá nhân đang độc lập hoặc team một dòng. Đại diện là agent active có ít
nhất 10 trận rating hoàn thành, không lỗi hạ tầng, và điểm `1000 + 40 × (μ − 3σ)`
cao nhất. User chưa đủ điều kiện nằm trong tab hiệu chỉnh; không cộng điểm giữa
agents. Agent bị vô hiệu hóa không giữ hạng, nhưng lịch sử vẫn được lưu.

Cột Agents mở `/arena/agents/<id>/history?matchId=<id>`; dấu `⋮` chỉ hiện khi có
nhiều agent đã qua validation và cho xem từng phiên bản, kể cả đã ngừng. Trang
Game History có danh sách trận/bộ lọc bên trái, replay bên phải; dùng lại bàn đấu
cũ, hỗ trợ URL chia sẻ, tải thêm, mobile và tự cập nhật 15 giây mà không tua lại
trận đang xem. Source code, tài khoản riêng tư và chi tiết lỗi hạ tầng không nằm
trong các API công khai; mọi API ghi vẫn yêu cầu quyền tương ứng.

API đọc: `/api/arena/leaderboard?tab=rankings|calibrating&search=...&page=1`,
`/api/arena/users/<id>/agents`, `/api/arena/agents/<id>/history?result=all&page=1&matchId=...`
và `/api/arena/agents/<id>/rating-history`. Hạng tính trước tìm kiếm/phân trang.
Phần leaderboard không reset dữ liệu; team cần migration bổ sung nêu trên.

Kiểm thử: `npm test`; `NEXT_BUILD_DIR=.next-leaderboard-test npm run build` rồi
`node scripts/e2e-leaderboard.mjs` từ thư mục Frontend. E2E cần Neon trong env,
Chrome tại `/opt/google/chrome/chrome` và cổng 3100 trống; tạo schema tạm riêng,
tự dọn sau kiểm thử, không dùng Redis hay khởi chạy worker. Báo cáo và ảnh nằm
trong `logs/ott_lb_e2e_*`.

## Ghi chú bảo mật

Bộ dữ liệu test mới có thể tạo bằng `scripts/reset-test-data.mjs` với xác nhận tường
minh `--apply --confirm RESET_PUBLIC_TEST_DATA`. Đây là thao tác xóa và thay dữ liệu
`public`: phải dừng frontend, giữ backend/supervisor để dừng job, sao lưu DB/Redis,
rồi mới truncate các bảng nghiệp vụ đã kiểm kê. Không dùng trên dữ liệu cần giữ.
Script giữ cấu hình và tạm dừng scheduler, tạo 10 user/20 agent đang validating.
Tiếp theo đổi `SESSION_SECRET`, khởi động lại frontend, chạy
`scripts/verify-fresh-test-data.mjs --directory <thư-mục-audit>` để xác minh đăng nhập,
phân quyền, self-play/replay thật và khôi phục chế độ trước đó. Worker tạm được hỗ
trợ bằng `--temporary-worker <worker-id>` khi không có worker chạy từ trước.
Mật khẩu sinh ngẫu nhiên và backup nằm trong `logs/fresh-test-data-*/`, quyền riêng
tư và đã loại khỏi Git. Cookie cũ phải bị vô hiệu hóa trước khi dùng lại các ID.
- Mật khẩu được hash bằng bcrypt, không lưu mật khẩu gốc.
- Session dùng cookie `HttpOnly`, `SameSite=Lax`, và `Secure` trong production.
- Đây là starter/demo. Trước khi dùng cho hệ thống công khai cần thêm rate limiting chống brute-force, xác minh email, quy trình quên mật khẩu, giám sát và chính sách bảo mật phù hợp.
