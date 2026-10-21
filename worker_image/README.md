# Worker Python trong một image

Worker này chứa supervisor, runtime, game engine, queue, lease và callback ngay
trong `worker_image/`. Entrypoint `main.py` dùng Python local trong sandbox Bubblewrap.
Không cần Judge0, Redis thực thi, Docker-in-Docker, Docker socket hay cổng public.
Backend FastAPI và frontend Next.js hiện tại vẫn cần chạy bên ngoài container.

Mã nguồn chính:

- `game_engine.py`: luật và trạng thái bàn cờ.
- `worker.py`: điều khiển trận, queue/callback và executor Python sandbox.
- `supervisor.py`, `runtime.py`: quản lý worker và process xử lý trận.
- `main.py`, `runner.py`, `sandbox_launcher.py`: chạy Python trong sandbox.

Không cần thư mục `worker/` cũ để chạy, build hoặc kiểm thử.

## Chạy

Từ repository root, có thể dùng script để build, self-check và chạy bản mới:

```bash
./dockerworker.sh
./dockerworker.sh logs
./dockerworker.sh status
./dockerworker.sh stop
```

Không cần `cd` về repository trước khi gọi script bằng đường dẫn tuyệt đối. Script
kiểm tra sandbox trước khi tạo lại container. `build` chỉ build/self-check; chạy
không tham số hoặc `update` mới áp dụng image bằng cách recreate container. Nếu
đã dừng worker trong admin, trạng thái đó vẫn được giữ; bấm Bật worker để xử lý job.

Từ thư mục gốc repository:

```bash
cp worker_image/.env.example worker_image/.env
# Điền URL và secrets trong worker_image/.env.
docker compose -f worker_image/compose.yaml build
docker compose -f worker_image/compose.yaml run --rm worker-python --check
docker compose -f worker_image/compose.yaml up -d
docker compose -f worker_image/compose.yaml logs -f
```

Build context là repository root; toàn bộ mã worker nằm trong `worker_image/`.
Image mặc định chỉ COPY những file được liệt kê, không COPY `.env`.
`--check` kiểm tra sandbox, không đăng ký hay nhận job. Cần điền secrets hợp lệ vì
entrypoint cũng kiểm tra cấu hình. Startup tự kiểm tra và từ chối nhận job nếu
sandbox không hoạt động; không có chế độ tự hạ xuống subprocess không cách ly.

Khi backend/frontend chạy trên host, dùng `host.docker.internal` như `.env.example`
và đảm bảo dịch vụ lắng nghe trên interface mà container truy cập được. Trong
production, dùng URL thực của dịch vụ. Không dùng `localhost` để trỏ đến host.

Image chạy dưới UID 10001, filesystem container chỉ đọc. Compose dành 1 GiB RAM,
không swap và tối đa 4 CPU cho toàn worker; chỉnh cùng với giới hạn concurrency.
Giới hạn tổng container cần bao gồm bộ nhớ worker, sandbox và các agent đồng thời.
Nếu container hết RAM, job đang chạy được lease recovery thu hồi sau đó.

## Đóng sẵn cấu hình để chuyển máy

Từ repository root chạy (máy xuất cần Python 3, gzip và Docker):

```bash
./dockerworker.sh export
```

Kết quả ở `worker_image/portable/`, chỉ gồm `worker-image.tar.gz`, `compose.yaml`
và `README.md` hướng dẫn Windows/Linux, chạy/dừng và xử lý lỗi. Gói giữ secrets và
các tham số từ `worker_image/.env`, thay URL bằng
`https://oantuti-backend.vercel.app` và `https://oantuti-three.vercel.app`;
không sửa `.env` gốc. Mỗi máy nhận dùng Docker volume lưu worker identity riêng.
Chuyển nguyên folder, máy nhận không cần source hay `.env` ngoài image.
Image chứa secrets; chỉ chuyển riêng cho máy/người tin cậy, không upload công khai.

Máy nhận dùng Linux Docker Engine hoặc Windows Docker Desktop (WSL 2, Linux
containers), cùng kiến trúc CPU với image. Lệnh cơ bản cho cả PowerShell và Bash:

```text
docker load -i worker-image.tar.gz
docker compose run --rm --no-deps worker-python --check
docker compose up -d --no-build
docker compose logs -f --tail 100 worker-python
docker compose stop worker-python
```

Chỉ chạy sau khi self-check báo `Python sandbox OK`. Xem đầy đủ tại
[PORTABLE.md](PORTABLE.md). Export không ghi đè gói đã có; di chuyển gói cũ trước
khi xuất lại. `MACHINE_ID`/`WORKER_MACHINE_ID_FILE` trong `.env` nguồn không được
nhúng để tránh trùng định danh giữa máy gửi và máy nhận.

## Nhiều worker Python

Các worker Python dùng chung backend/frontend/secrets và queue FIFO. Backend claim
atomic nên mỗi delivery chỉ có một owner. Worker xử lý rating, validation và
friendly. Không có executor HTTP, cấu hình hay script cài Judge0 cho worker chính.
Runner chung kết độc lập nằm ngoài phần này.

Worker ID là hash của machine identity và tên. Compose mount `/etc/machine-id`
read-only để identity không đổi khi recreate. Mỗi máy có thể dùng cùng tên
`local-python`; trên cùng host, mỗi worker phải có tên khác nhau. Khi chạy native
trên Linux đã cài Bubblewrap và dependencies:

```bash
cd worker_image
python3 main.py --name alpha
python3 main.py --name beta
```

Admin `/admin/workers` điều khiển start, pause/resume, graceful/immediate stop và
concurrency riêng cho từng worker. Supervisor vẫn online khi runtime bị dừng.
Trạng thái và concurrency lưu trong Redis; `MAX_CONCURRENT` chỉ dùng cho lần đăng
ký đầu. Worker trùng machine/name bị chặn trước khi self-check hoặc đăng ký.

`judge0_url` chỉ còn là tên trường giao thức cũ để tương thích dữ liệu hiện có;
giá trị worker gửi luôn là `local-python://bubblewrap`. Đây không phải URL HTTP
và không được dùng để kết nối dịch vụ thực thi bên ngoài.

## Giới hạn và sandbox

Mỗi **lượt** tạo process Python mới, không lưu globals giữa các lượt. Observation/configuration vào stdin, nước đi JSON ra stdout;
tuple/list bốn tọa độ và object vẫn được hỗ trợ như trước. Rating/friendly tối đa 200 nước, không dừng sớm khi lặp thế cờ; validation tối đa
60 nước. Retry hạ tầng và callback fencing dùng chung code hiện tại. Frontend tính
phạt draw rating từ replay (4–32 điểm mỗi bên), đồng thời giảm σ để tăng độ tin cậy
và giúp scheduler kết thúc hiệu chỉnh. Friendly không thay đổi BXH. Chính sách này
nằm ở frontend và dùng chung cho mọi worker Python.

- `AGENT_CPU_SECONDS`: CPU time, hard `RLIMIT_CPU`.
- `AGENT_WALL_SECONDS`: thời gian thực, kể cả khởi động sandbox; quá hạn thì kill.
- `AGENT_MEMORY_MB`: MiB không gian địa chỉ, hard `RLIMIT_AS`, **không phải RSS**.
- `AGENT_OUTPUT_BYTES`: tổng stdout/stderr; vượt giới hạn thì dừng agent.
- `AGENT_SOURCE_BYTES`: giới hạn source trước khi tạo process.

Bubblewrap tạo namespace riêng cho PID, network, mount, IPC và UTS; agent không
thấy `/app`, `.env`, thư mục home hay filesystem host. Chỉ mount Python/system
libraries, source agent và launcher ở chế độ chỉ đọc; không có thư mục ghi file.
Environment sạch, không chứa secrets. Launcher đặt hard resource limits và
seccomp trước khi chạy code: cấm tạo process/thread, socket và thay namespace.
Agent chỉ có Python standard library, không cài dependency của worker vào sandbox.
Code cần network, subprocess, threading hoặc ghi file sẽ không được hỗ trợ.

Lỗi code, nước sai, CPU/wall timeout, thiếu memory và output quá lớn là lỗi agent.
Không khởi tạo được sandbox là lỗi hạ tầng; không bị ghi thành agent thua.
Pause không ngắt trận; immediate stop hoặc mất lease hủy runner đang chạy. Job
chưa hoàn tất được recovery như worker cũ.

Host cần Linux hỗ trợ unprivileged user namespaces. Compose nới profile seccomp
và AppArmor **của outer container** để Bubblewrap tạo nested namespaces; filter
seccomp riêng vẫn áp dụng cho agent. Không dùng `--privileged` hay mount Docker
socket. Một số môi trường managed/LXC chặn user namespaces ở cấp host; `--check`
sẽ báo lỗi và cần cấu hình host phù hợp. Sandbox này chia sẻ kernel host, không
phải VM; dùng kernel được cập nhật cho môi trường nhận code không tin cậy.

Tham khảo: [Bubblewrap](https://github.com/containers/bubblewrap),
[Python resource limits](https://docs.python.org/3/library/resource.html),
[Docker seccomp](https://docs.docker.com/engine/security/seccomp/).

## Kiểm tra

```bash
# Test target không cần .env hay dịch vụ bên ngoài.
docker compose -f worker_image/compose.yaml --profile test build worker-tests
docker compose -f worker_image/compose.yaml --profile test run --rm worker-tests

# Hoặc trên host đã cài backend/requirements.txt:
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend python3 -m pytest -q worker_image/tests backend/tests/test_worker.py backend/tests/test_supervisor.py backend/tests/test_queue.py backend/tests/test_worker_control.py
```

Các test sandbox thực cần Bubblewrap, `/usr/bin/python3`, libseccomp và quyền tạo
user namespaces. Không có sandbox sẽ skip các test này; có thể bắt buộc chạy bằng
`REQUIRE_SANDBOX_TESTS=1` (test target luôn bật cờ này). Không test nào cần truy cập
database thật. Test image là target riêng; production image không chứa test dependencies.

Để thử end-to-end bằng frontend/backend local, production Docker image và Neon/Redis
thật đã cấu hình trong repository:

```bash
node worker_image/test-local.mjs
```

Lệnh này mặc định cần cổng 3000/8000 đang trống; dùng `LOCAL_TEST_FRONTEND_PORT`
và `LOCAL_TEST_BACKEND_PORT` để chọn cổng khác. Cần dependencies frontend/backend đã cài và image
đã build. Script tạo schema/Redis namespace riêng, nộp agent qua API, kiểm tra
validation (kể cả lỗi Python, memory, timeout và output), rating/TrueSkill, friendly,
replay, admin controls và ACK. Khi xong, script dừng các dịch vụ vừa tạo, xóa dữ liệu
test và giữ báo cáo/log trong `logs/worker_image_local_*/`. Không dùng dữ liệu public
của hệ thống cho các trận test.
