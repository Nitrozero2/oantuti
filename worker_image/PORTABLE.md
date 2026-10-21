# Oantuti worker — gói chuyển máy

Chuyển nguyên folder này sang máy nhận. Chỉ cần 3 file: `worker-image.tar.gz`,
`compose.yaml`, `README.md`. Không cần repository, Python, Node.js, build hay `.env`
ngoài image. Hai URL đã cấu hình sẵn:

- Frontend/admin: https://oantuti-three.vercel.app/admin/workers
- Backend: https://oantuti-backend.vercel.app

Secrets và các tham số xử lý được lấy từ `worker_image/.env` lúc xuất gói;
hai URL được thay bằng địa chỉ trên. `.env` gốc không bị sửa. Không sao chép
`MACHINE_ID` của máy xuất: mỗi bản cài có định danh riêng lưu trong Docker volume.
Image chứa secrets đọc được bởi người giữ image; chỉ gửi riêng cho máy tin cậy.

## Máy nhận cần gì?

- CPU Intel/AMD x86-64 nếu platform cuối tài liệu là `linux/amd64`.
  Gói này không được kiểm thử trên ARM hoặc qua giả lập CPU.
- Linux: Docker Engine và Docker Compose plugin; kernel cho phép user namespaces.
- Windows: Docker Desktop đang chạy, dùng **Linux containers**, backend WSL 2,
  bật virtualization. Worker chạy trong Linux VM của Docker Desktop.
- Internet HTTPS tới frontend/backend trên. Không cần mở port inbound.
- Container giới hạn 1 GiB RAM, 4 CPU, 256 PID. Máy cần thêm tài nguyên cho OS/Docker;
  concurrency mặc định 4, có thể điều chỉnh ở trang admin.

Hướng dẫn chính thức:
[Windows/WSL 2](https://docs.docker.com/desktop/setup/install/windows-install/),
[Docker Engine Linux](https://docs.docker.com/engine/install/),
[Compose plugin](https://docs.docker.com/compose/install/linux/).

## Windows: chạy bằng PowerShell

Mở Docker Desktop trước. Giải nén/copy folder vào ví dụ `C:\oantuti-worker`,
mở PowerShell tại đó (đường dẫn chứa dấu cách phải có dấu nháy):

```powershell
cd C:\oantuti-worker
docker info --format '{{.OSType}}/{{.Architecture}}'
docker compose version
docker load -i worker-image.tar.gz
docker compose run --rm --no-deps worker-python --check
docker compose up -d --no-build
docker compose ps
docker compose logs -f --tail 100 worker-python
```

Chỉ chạy `up` sau khi `--check` in `Python sandbox OK` và exit code 0.
Docker đọc trực tiếp file `.tar.gz`; không cần gunzip hay cài Python trên Windows.
Nhấn Ctrl+C chỉ thoát xem log; worker vẫn chạy nền. Máy khởi động lại cần Docker
Desktop khởi động thì container mới tự chạy tiếp.

## Linux: chạy bằng terminal

```bash
cd /duong-dan/oantuti-worker
docker info --format '{{.OSType}}/{{.Architecture}}'
docker compose version
docker load -i worker-image.tar.gz
docker compose run --rm --no-deps worker-python --check
docker compose up -d --no-build
docker compose ps
docker compose logs -f --tail 100 worker-python
```

Nếu tài khoản chưa có quyền Docker, dùng `sudo` trước các lệnh Docker.
Chỉ chạy `up` khi self-check thành công. Ctrl+C thoát xem log, không dừng worker.
Docker daemon phải được bật khi khởi động máy để tự chạy lại worker.

## Dừng / chạy lại (giống nhau trên Windows và Linux)

Chạy trong folder chứa `compose.yaml`:

```text
docker compose stop worker-python
docker compose ps -a
```

Lệnh dừng container, mặc định chờ tối đa 20 giây cho shutdown. Trận chưa hoàn tất
được queue/lease recovery xử lý lại. Container đã `stop` không tự bật khi Docker
restart; dùng lệnh dưới để chạy lại:

```text
docker compose up -d --no-build
```

Muốn chờ trận hiện tại kết thúc: vào trang admin, chọn dừng graceful; chờ
active jobs = 0 rồi chạy `docker compose stop worker-python`. Dừng qua admin
chỉ dừng runtime nhận trận; supervisor/container vẫn online. Nếu admin lưu trạng
thái dừng, cần bấm **Bật worker** sau khi khởi động container.

Gỡ container và network nhưng giữ định danh:

```text
docker compose down
```

Không dùng `down -v` khi muốn giữ worker ID. Volume định danh tồn tại qua recreate
và `down`; gói sao chép sang máy khác sẽ tạo volume/worker ID mới. Compose dùng tên
project cố định `oantuti-worker-portable`: các bản copy trên cùng Docker daemon
quản lý cùng một worker. Muốn nhiều worker trên một máy, dùng `docker compose -p ten-rieng`
cho **mọi** lệnh của từng bản cài để tạo container/volume riêng.

## Kiểm tra và xử lý lỗi

1. `docker compose run --rm --no-deps worker-python --check` phải báo sandbox OK.
   Lệnh này không đăng ký worker và không claim job.
2. Sau `up`, xem log và trang admin để kiểm tra worker online, không có lỗi 401,
   TLS, registration hoặc sandbox. Trạng thái xử lý phụ thuộc điều khiển đã lưu ở admin.
3. Nếu sandbox lỗi `Operation not permitted`/user namespaces: kiểm tra quyền namespace
   của Linux host; trên Windows kiểm tra WSL 2 và Linux containers. Không bỏ qua
   sandbox hoặc bật `privileged` để ép chạy. Không thể cam kết tương thích mọi host;
   self-check là điều kiện bắt buộc trên máy nhận.
4. Lỗi 401: secrets nhúng không khớp deployment, cần xuất lại từ `.env` đúng.
   Lỗi mạng: kiểm tra DNS/HTTPS tới hai domain, proxy và đồng hồ máy.
5. Không thấy worker sau khi start: kiểm tra `docker compose logs --tail 100`;
   container `Up` một mình chưa chứng minh kết nối backend thành công.

Có thể ghi đè tham số bằng `environment:` trong `compose.yaml`, ví dụ
`MAX_CONCURRENT: '2'`; concurrency chỉ dùng lúc đăng ký mới, sau đó chỉnh ở admin.
Không cần tải image từ registry: compose đặt `pull_policy: never`.
Nếu cần export lại, trên máy có source chạy `./dockerworker.sh export`;
di chuyển folder `worker_image/portable` cũ trước khi xuất gói mới.

Kiểm tra file sau khi chuyển: Linux chạy `sha256sum worker-image.tar.gz`;
Windows chạy `Get-FileHash .\worker-image.tar.gz -Algorithm SHA256`.
So sánh với SHA256 ở cuối tài liệu.
