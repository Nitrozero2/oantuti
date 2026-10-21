# Worker Chung kết theo vòng

Năm dịch vụ riêng: `round_16` (1), `quarterfinal` (2), `semifinal` (3), `final` (4), `third_place` (5). Chung kết và tranh hạng ba đều theo kết quả bán kết, không phải hai vòng nối tiếp. Mỗi worker chỉ có engine và credential của vòng mình. Không import worker rating, không dùng Judge0/Redis, không kết nối database trực tiếp.

## Cài đặt

Từ thư mục gốc repo, tạo credential riêng cho từng vòng:

```bash
python3 worker_ck/configure.py --url http://host.docker.internal:3000
```

Lệnh tạo năm file `.env.<tên_worker>` và `worker_ck/.env.frontend`, quyền 0600; từ chối ghi đè. Đưa biến `CK_WORKER_TOKENS` trong `.env.frontend` vào môi trường frontend (ví dụ `Frontend/.env.local`), rồi khởi động lại frontend. Đây là JSON object có key `1`–`5`, năm token khác nhau dài ít nhất 32 ký tự. Không công khai hoặc commit các file này. Dùng URL HTTPS nếu frontend ở máy khác.

Kiểm tra migration trước, từ `Frontend`:

```bash
node scripts/migrate-finals.mjs
node scripts/migrate-finals.mjs --apply
```

Dry run chỉ đọc. Apply chạy một transaction, khóa bảng, kiểm tra lại vòng cũ đang mở/lần chạy cũ còn hoạt động và dừng với `CK_LEGACY_ACTIVE_ROUND` nếu có; cần chủ giải quyết định riêng. Không tự ngắt hoặc hủy ván. Migration giữ lịch sử và lưu backup gốc trong `ck_upgrade_backup`, cùng bản sao file riêng quyền 0600 tại `logs/ck-upgrade-*/backup.json`. Không áp dụng lại migration gốc bằng tay sau nâng cấp; luôn dùng script này. Nó kiểm tra dữ liệu rating trước/sau và chỉ thay schema Chung kết.

Build và kiểm tra từng image trước khi chạy:

```bash
docker compose -f worker_ck/compose.yaml build
for worker in round_16 quarterfinal semifinal final third_place; do
  docker compose -f worker_ck/compose.yaml run --rm "$worker" --check || break
done
docker compose -f worker_ck/compose.yaml up -d
```

Máy Linux cần user namespaces; Compose cho phép Bubblewrap tạo sandbox lồng bên trong container. Agent vẫn bị chặn syscalls, mạng, subprocess, đọc secrets, ghi filesystem và có giới hạn CPU/RAM/output. Nếu sandbox không khởi động được, worker từ chối đăng ký/nhận bài. Image không nhúng env hoặc database credential. Dockerfile-specific ignore chỉ đưa code đúng worker và khung chung vào build context.

`CK_RELEASE` dùng làm tag image. Dùng tag riêng cho mỗi lần phát hành và giữ image cũ cho các vòng đã khóa; không ghi đè image đang cần để chạy lại ván. `CK_WORKER_ID` phải khác nhau giữa hai instance cùng loại vòng. Mỗi instance mặc định chạy 1 job; có thể thêm `--concurrency 2` (tối đa 8). Mặc định mỗi lượt agent: CPU 2 giây, wall 4 giây, RAM 128 MiB, output 64 KiB, source 1 MiB.

Chạy native nếu cần:

```bash
python3 -m venv worker_ck/.venv
worker_ck/.venv/bin/pip install -r worker_ck/requirements.txt
set -a
source worker_ck/.env.round_16
set +a
worker_ck/.venv/bin/python -B -m worker_ck.round_16
```

## Vận hành giải

1. Chốt top 16 và thành viên. Trong `/admin/finals`, chọn engine của đúng vòng rồi mở nhận bài.
2. Người có suất vào `/finals/<id>` → **Agent dự thi Chung kết**. Mỗi vòng phải nộp lại, cho phép code giống lần trước; agent rating không được tự lấy làm bài. Thành viên đội theo danh sách lúc chốt suất đều có quyền nộp/xem code của đội.
3. Đúng worker chạy self-play theo engine của vòng. Bản nộp mới nhất phải hợp lệ; bản mới lỗi không tự lấy bản cũ thay thế. Không có worker đúng engine thì bài tiếp tục chờ.
4. Khi mọi suất đã có bài hợp lệ, admin khóa bài rồi mở đấu. Hai ván đổi bên dùng cùng snapshot. Lỗi ván cần admin quyết định ngắt, chạy lại, chỉ định hoặc nhập bản ghi; không tự xử thua/retry. Kết quả cặp chỉ đổi sau xác nhận của admin.
5. Vòng sau phải nộp mới. Rating, friendly và agent thường không thay đổi.

## Thay engine một vòng

Chỉ sửa `engine.py`, `board.py`, `manifest.json` trong thư mục của vòng đó, build image mới và khởi động worker mới. Khung chung tính checksum từ code engine, manifest, runtime/sandbox và giới hạn thực thi. Admin chọn checksum đăng ký trước khi mở nhận bài. Sửa khung chung làm thay checksum của cả 5 loại worker.

Hợp đồng engine: `FinalsGame(rules)`, `current_player`, `move_count`, `rules`, `outcome`, `reason`, `observation()`, `step(action)`, `snapshot()`. Snapshot có `display` gồm board phẳng 81 ô, `terrain:[{col,row}]`, `bonus_cells:[{col,row,points}]`, `scores:{"1":number,"2":number}`. Các phần nội bộ engine không trả công khai. Observation giữ các trường OTT cũ và thêm dữ liệu trong `finals`; agent vẫn là `agent(observation, configuration)`.

Ban đầu 5 bản giữ luật 150 nước/hòa lặp ba lần. Chưa thêm luật obstacle/ô điểm; hợp đồng hiển thị và observation đã hỗ trợ để từng engine bổ sung sau. Trước khi khóa bài có thể mở lại nhận bài với engine mới: toàn bộ bài của đợt nhận cũ mất hiệu lực và phải nộp mới. Sau khi khóa/mở đấu không đổi engine hoặc code. Giữ image/checksum cũ cho retry và offline.

## Offline và replay

Admin tải bundle kín v2 chứa bài Chung kết đã khóa, không dùng code rating. Dùng đúng worker/image/giới hạn đã khóa:

```bash
worker_ck/.venv/bin/python -B -m worker_ck.round_16 \
  --bundle /private/finals.bundle.json --game 1 --output /private/game-1.record.json
```

Offline vẫn dùng sandbox, không cần credential hoặc database, từ chối sai vòng/checksum và không ghi đè output. Output quyền 0600, có initial state và snapshot hiển thị từng nước. Nhập JSON tại admin; bản ghi nhập được gắn nhãn tin admin, chỉ kiểm tra cấu trúc chứ không chứng minh nước đi đúng luật. Replay cũ tiếp tục hiển thị định dạng cũ.

## Kiểm thử

```bash
REQUIRE_SANDBOX_TESTS=1 python3 -m pytest -q worker_ck/tests
node Frontend/scripts/e2e-finals.mjs
cd Frontend && npm run build
```

E2E dùng PostgreSQL trong bộ nhớ, HTTP handler thật và worker/sandbox thật. Không đọc env database production, không tạo job rating hay sửa dữ liệu production. Nếu thiếu quyền chạy Bubblewrap, E2E thất bại; unit tests Python chỉ được skip sandbox khi không đặt `REQUIRE_SANDBOX_TESTS=1`.

### Chạy toàn mùa trên host thật và Neon thật

```bash
node Frontend/scripts/e2e-finals-hosted.mjs --run
node Frontend/scripts/e2e-finals-hosted.mjs --verify
```

Lệnh tạo hai schema riêng trong Neon đã cấu hình, dùng production build trên cổng 3305
(có thể đổi bằng `CK_SEASON_PORT`) và 5 container worker có token riêng. Có 16 suất thử,
trong đó một suất đội với hai thành viên; tài khoản người ngoài không được đọc/nộp code.
Dữ liệu đủ điều kiện top 16 là fixture trong schema thử. Cả 32 self-play và 32 ván Chung kết
đều chạy qua worker/sandbox thật, không giả lập API hoặc chỉ định kết quả.
Mỗi vòng nộp mới, khóa, mở đấu, công bố replay và xác nhận người thắng qua ứng dụng.
Chrome kiểm tra thao tác admin, nộp bài, sơ đồ cuối trên desktop/mobile và replay.
Bộ kiểm tra còn chạy lại 32 replay để xác minh nước đi, snapshot và kết quả bằng đúng engine.

Host và worker được giữ online để xem lại. Địa chỉ, PID/container, schema và đường dẫn báo cáo
lưu trong `logs/ck-season-state.json`; `REPORT.md`, `report.json`, tài khoản thử `accounts.json`
và ảnh nằm trong thư mục log của mùa. File chứa tài khoản/token có quyền 0600 và được bỏ qua bởi Git.
Không sửa env hiện có hoặc dữ liệu rating/Chung kết production. So sánh fingerprint dữ liệu trước/sau.

Nếu bộ kiểm tra dừng giữa chừng, `--resume` tiếp tục đúng mùa và giữ các kết quả đã xác nhận.
Dừng đúng các dịch vụ do bộ kiểm tra tạo bằng `--stop`; thêm `--cleanup` mới xóa hai schema thử,
không xóa log hoặc động tới giải thật. Worker cần Docker, user namespaces và Chrome được cài sẵn.

### Đưa mùa thử đã hoàn tất vào database chính để demo

```bash
node Frontend/scripts/import-finals-demo.mjs
node Frontend/scripts/import-finals-demo.mjs --apply
```

Lệnh mặc định chỉ kiểm tra. `--apply` sao lưu dữ liệu, nâng cấp schema Chung kết nếu cần,
rồi nhập mùa vào `finals` trong một transaction. ID của tài khoản, đội, bài nộp, cặp,
ván và lần chạy được cấp mới, các liên kết và nhật ký được ánh xạ lại. Tài khoản thử
được thêm với quyền thường; admin thật và mật khẩu hiện có được giữ nguyên.
Các agent tham chiếu cũ được lưu ở trạng thái archive (private, inactive, rejected),
không nhập các trận fixture dùng để tạo điều kiện rating vào database chính.
Giữ nguyên code Chung kết, điểm cặp, người thắng, 32 ván và 348 nước đi đã chạy thật.
Không sao chép worker đang online hoặc token/lease của các lần chạy đã kết thúc.

Lệnh dừng nếu có giải đang mở hoặc tên tài khoản trùng. Nhập lại cùng mùa trả ID
đã nhập, không tạo bản trùng. Backup và ánh xạ ID ở thư mục `logs/ck-demo-import-*`,
quyền riêng tư 0600; trạng thái gần nhất ở `logs/ck-demo-import-state.json`.
