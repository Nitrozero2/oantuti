# Chương trình Chung kết độc lập

Không import worker/backend hiện tại, không Redis, chỉ đọc/ghi schema `finals`.
Game engine `ott-finals-v1` là bản sao độc lập đã đóng phiên bản; thay luật bằng
phiên bản mới, không sửa engine v1 của giải đã bắt đầu.

## Cài và chạy

Từ thư mục gốc dự án:

```bash
python3 -m venv finals_runner/.venv
finals_runner/.venv/bin/pip install -r finals_runner/requirements.txt
```

Tạo `finals_runner/.env` theo `.env.example`, dùng kết nối tới cùng database Neon
nhưng `FINALS_SCHEMA=finals`. Không commit file env hay bundle chứa code.
Chương trình không tự đọc env của backend/worker thường.
Nếu môi trường chỉ kết nối được một địa chỉ Neon, có thể đặt tùy chọn
`FINALS_DB_HOSTADDR` thành địa chỉ IP đó; DSN/hostname TLS vẫn giữ nguyên.

```bash
set -a
source finals_runner/.env
set +a
finals_runner/.venv/bin/python -m finals_runner --concurrency 1
```

Cho phép 1–8 ván đồng thời; hai ván trong một cặp chạy lần lượt. Mỗi process phải
có `FINALS_WORKER_ID` khác nhau. Instance trùng ID bị từ chối khi heartbeat cũ còn
sống. Judge0 có thể dùng chung `http://localhost:2358`; điều đó vẫn chia sẻ tải
thực thi với hệ thống thường dù job/database/engine của hai chương trình tách biệt.

Luật v1: bàn và quân cũ, 150 nước tổng hai bên, hòa khi cùng thế cờ/cùng bên tới
lượt xuất hiện ba lần. Agent vẫn là `agent(observation, configuration)` với nước
đi dạng tọa độ hoặc `from_pos`/`to_pos`. Observation giữ các trường cũ và thêm
`finals` chứa phiên bản, terrain rỗng và điểm 0. Chưa triển khai tường/ô thưởng.

Mỗi nước được lưu với execution token và thứ tự tăng dần; lease gia hạn mỗi 5
giây. Mọi lỗi và ngắt process đều chờ admin; không tự retry hay xử thua. Khi mất
database không thể ghi lỗi, process tiếp theo nhận việc sẽ đánh dấu lease hết hạn
là cần admin. Trang admin cũng có thao tác ngắt ván để xử lý sự cố. Ctrl+C dừng
process và bảo toàn các nước đã commit, không tự tiếp tục ván cũ.

## Chạy local và xuất bản ghi

Admin khóa luật, mở vòng rồi tải bundle ở `/admin/finals`. Bundle chứa mã nguồn
snapshot: chỉ admin được tải; giữ file kín. Chạy một ván trong bundle qua Judge0:

```bash
finals_runner/.venv/bin/python -m finals_runner \
  --bundle /duong/dan/finals.bundle.json --game 1 --output /duong/dan/game-1.record.json
```

Chế độ này không kết nối database, không cập nhật bảng xếp hạng hoặc giải. File
output được tạo mới với quyền 0600, không ghi đè file sẵn có. Dừng nếu agent/Judge0
lỗi; admin vẫn có thể tự chuẩn bị bản ghi. Import vào đúng ván trên trang admin:

```json
{"game_id":1,"outcome":"draw","moves":[{"player":1,"from_col":1,"from_row":3,"to_col":0,"to_row":3,"piece_type":"ROCK","captured_type":null}]}
```

Admin nhập lý do bắt buộc, công bố ván rồi xác nhận kết quả cặp khi đủ hai ván.
Import **tin admin**, không kiểm chứng nước đi đúng luật hoặc thực sự chạy đúng
code. Chỉ kiểm tra cấu trúc an toàn: tối đa 5 MB/10.000 nước, tọa độ 0–8, player
1/2 và ba loại quân. Luôn gắn nhãn nhập thủ công; không sửa luật hoặc người chơi
của ván theo file. Replay/import là lần chạy riêng, không ghi đè lần lỗi cũ.

## Trình chiếu

Chọn ván và công bố từ trang admin. Public chỉ lấy được lịch sử đã công bố;
admin dùng link xem nội bộ trước khi phát. Trang ván hỗ trợ fullscreen, dừng,
tua và tốc độ 2,4 / **1,2 mặc định** / 0,6 / 0,3 giây/nước. Mỗi người tự phát, không
có timeline công bố chung. Khi chưa có nước mới thì giữ bàn cờ và chờ. Khi đã
công bố bản ghi, người xem có thể tua tới cuối; kết quả sơ đồ chỉ thay đổi khi admin
xác nhận cặp. Có tranh hạng ba; hai ván hòa điểm thì hạt giống cao hơn thắng cặp.
