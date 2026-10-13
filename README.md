# OTTv2 Arena




## 1. Giới thiệu

**OTTv2 Arena** (Oẳn Tù Tì v2) là hệ thống đánh giá và thi đấu tự động giữa các Agent AI. Dựa trên biến thể trò chơi dân gian Oẳn Tù Tì kết hợp cùng tư duy chiến thuật cờ bàn (board game), nền tảng cung cấp môi trường khép kín cho sinh viên UET.

Thực hiện bởi Nhóm 1 - INT3304 3:
1. Nguyễn Thiên Tuấn
2. Bùi Thanh Sơn
3. Phạm Gia Hưng
4. Nguyễn Văn Tuyên 

---

## 2. Kiến trúc dự án

Dự án áp dụng kiến trúc tách biệt giữa giao diện máy trạm (Vercel), cơ sở dữ liệu serverless (Neon), và máy chủ chấm giải AI cục bộ thông qua đường truyền bảo mật (Cloudflare Tunnel).

### 2.1. Sơ đồ kiến trúc tổng quan

```text
Người dùng (Browser)
      │
      ▼
┌────────────────────────────────────────────────────────┐
│               Frontend (Next.js 15 App)                │  ← Always-online (Vercel)
│  - Authentication, Quản lý tài khoản (JWT, Bcrypt)     │
│  - Trình soạn thảo Code (CodeMirror Python)            │
│  - Bảng xếp hạng ELO, Replay Player, Dashboard         │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
        (Kết nối Database)         (Khi chạy trận/validate)
               ▼                          ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│    Neon PostgreSQL           │   │    Cloudflare Tunnel         │  ← Reverse Proxy HTTPS
│    (Serverless DB)           │   └──────────────┬───────────────┘
│  - Users, Agents, Elo Stats  │                  ▼
│  - Matches, Moves Replay     │   ┌──────────────────────────────┐
│  - Tournament Sessions       │   │    FastAPI Backend Server    │  ← Localhost :8000
└──────────────────────────────┘   │  ├── Match Service (Vòng đời)│
                                   │  ├── Game Engine (Pure Python│
                                   │  └── Judge0 Client Adapter   │
                                   └──────────────┬───────────────┘
                                                  ▼
                                   ┌──────────────────────────────┐
                                   │    Judge0 CE (Docker Sandbox)│  ← Localhost :2358
                                   │    PostgreSQL + Redis        │
                                   │    Thực thi Python 3 an toàn │
                                   └──────────────────────────────┘
```

### 2.2. Chi tiết các thành phần

| Thành phần | Công nghệ sử dụng | Nhiệm vụ chính |
| :--- | :--- | :--- |
| **Frontend** | Next.js 15, React 19, Tailwind CSS | Giao diện phong cách Brutalist/Paper phẳng, hiển thị bàn cờ, xác thực, quản lý và theo dõi. |
| **Backend API** | Python 3.10+, FastAPI, Uvicorn | Quản lý vòng đời trận đấu, cung cấp API tính toán trạng thái bàn cờ, điều phối lượt đi. |
| **Game Engine** | Pure Python 3 | Mô phỏng chính xác 100% logic bàn cờ 9×9, kiểm tra nước đi hợp lệ, điều kiện thắng/thua. |
| **Execution Sandbox** | Judge0 CE (Docker) | Chạy code agent Python của người dùng trong container riêng biệt, giới hạn RAM, CPU và Timeout 10s. |
| **Database** | PostgreSQL (Neon Database) | Lưu trữ người dùng, mã nguồn các version bot, log từng nước đi, chỉ số ELO và phiên giải đấu. |

---

## 3. Tính năng

### 3.1. Dành cho thí sinh (Người chơi)
* **Xác thực an toàn:** Đăng ký, đăng nhập bảo mật bằng JWT lưu trong HttpOnly Cookie và mã hóa mật khẩu Bcrypt.
* **Soạn thảo & Nộp Agent trực tiếp:**
  * Trình soạn thảo tích hợp **CodeMirror** (hỗ trợ gợi ý cú pháp Python, One Dark theme, đếm ký tự đến 65.536 bytes).
  * Nút **"🔍 Kiểm tra tính hợp lệ"**: Tự động đưa code vào Sandbox Judge0 chạy thử nghiệm một nước đi mẫu trước khi nộp chính thức.
  * Quản lý lịch sử các phiên bản bot (`v1`, `v2`,...), theo dõi trạng thái duyệt (`Pending`, `Active`, `Rejected`).
* **Đấu đối kháng giao hữu (Friendly Match Realtime):**
  * Tùy chọn 2 bot AI bất kỳ để thi đấu 1v1 ngay trên bàn cờ mà không ảnh hưởng đến điểm rank.
  * Cập nhật từng nước đi theo thời gian thực bằng cơ chế **Server-Sent Events (SSE)**.
* **Bảng xếp hạng & Hệ thống Rank ELO:**
  * Hệ thống tính điểm ELO gồm các mức rank:
    * 👑 **Grandmaster** (ELO ≥ 2000)
    * 💎 **Master** (ELO ≥ 1800)
    * 🔷 **Expert** (ELO ≥ 1600)
    * 🟢 **Intermediate** (ELO ≥ 1400)
    * ⚪ **Novice** (ELO < 1400)
  * Thống kê Win/Loss/Draw và tỷ lệ thắng.
* **Trình phát lại ván cờ (Interactive Replay Player):**
  * Xem lại chi tiết từng ván cờ đã chơi.
  * Thanh trượt tua thời gian, các nút điều khiển (*Về đầu, Lùi bước, Tự động phát, Tiến bước, Về cuối*) và chỉnh tốc độ từ 100ms – 2000ms/nước.

### 3.2. Dành cho Ban tổ chức (Quản trị viên - Admin)
* **Duyệt Agent:** Kiểm tra code của thí sinh, chạy thử nghiệm và quyết định cấp quyền thi đấu.
* **Quản lý Tournament:** Tạo phiên giải đấu (Session), thiết lập số trận đấu song song, khởi động hoặc tạm dừng worker tự động chạy vòng tròn.
* **Playground Test Bot:** Giao diện ghép cặp thủ công nhanh chóng cho mục đích gỡ lỗi (debug).
* **Quản lý & Cấu hình:** Xem toàn bộ lịch sử đấu, dọn dẹp dữ liệu rác, cập nhật linh hoạt đường dẫn Backend Tunnel.

---

## 4. Thể lệ cuộc thi

### 4.1. Quy chuẩn bàn cờ & Bố trí ban đầu
* **Kích thước bàn cờ:** Bàn cờ dạng lưới hình vuông **9 × 9 ô**, cột ký hiệu từ `a` đến `i` (chỉ số 0 đến 8), hàng ký hiệu từ `1` đến `9` (chỉ số 0 đến 8).
* **Các loại quân cờ:** Mỗi người chơi sở hữu 10 quân cờ thuộc 3 loại:
  * ✊ **ĐẤM (ROCK):** 3 quân
  * ✋ **LÁ (PAPER):** 4 quân
  * ✌️ **KÉO (SCISSORS):** 3 quân
* **Tọa độ xuất phát ban đầu:**
  * **Người chơi 1 (P1 - Quân Xanh):** Căn cứ đóng tại ô **`i9`**.
    * ✌️ Kéo (3): `5c`, `4d`, `3e`
    * ✋ Lá (4): `5b`, `4c`, `3d`, `2e`
    * ✊ Đấm (3): `4b`, `3c`, `2d`
  * **Người chơi 2 (P2 - Quân Đỏ):** Căn cứ đóng tại ô **`a1`**.
    * ✌️ Kéo (3): `7e`, `6f`, `5g`
    * ✋ Lá (4): `8e`, `7f`, `6g`, `5h`
    * ✊ Đấm (3): `8f`, `7g`, `6h`

### 4.2. Quy tắc di chuyển & Cơ chế ăn quân
* **Di chuyển:** Mỗi lượt, một quân cờ có thể di chuyển **1 ô** theo **8 hướng** (ngang, dọc, chéo – tương tự như nước đi của quân Vua trong cờ vua).
* **Quy tắc ăn quân Oẳn Tù Tì:**
  * ✊ **ĐẤM** ăn ✌️ **KÉO**
  * ✋ **LÁ** ăn ✊ **ĐẤM**
  * ✌️ **KÉO** ăn ✋ **LÁ**
* **Lưu ý:**
  * Hai quân **cùng loại không thể ăn nhau** (không thể đi vào ô có quân cùng loại của đối phương).
  * Quân cờ không được di chuyển vào ô đang có quân của phe mình.

### 4.3. Điều kiện thắng - thua
Một ván đấu sẽ kết thúc ngay lập tức khi xảy ra một trong các điều kiện sau:

1. **Chiếm cứ điểm đối phương:**
   * **P1 thắng:** Đưa bất kỳ một quân cờ nào của mình tiến vào căn cứ **`i9`**.
   * **P2 thắng:** Đưa bất kỳ một quân cờ nào của mình tiến vào căn cứ **`a1`**.
2. **Triệt hạ quân chủng đối phương:**
   * Một người chơi sẽ thắng nếu ăn hết toàn bộ một chủng loại quân bất kỳ của đối thủ (ăn sạch 3 quân Đấm, HOẶC sạch 4 quân Lá, HOẶC sạch 3 quân Kéo).
3. **Xử thua kỹ thuật (Disqualification):**
   * **Quá thời gian (Timeout):** Agent tính toán vượt quá **10 giây/nước đi**.
   * **Nước đi phạm quy (Illegal Move):** Trả về nước đi không nằm trong danh sách nước đi hợp lệ (`valid_moves`).
   * **Lỗi thực thi (Runtime Error):** Mã nguồn phát sinh ngoại lệ (Exception/Crash) trong quá trình thực thi trên Judge0.
   * **Đầu hàng:** Agent trả về `None` khi vẫn còn nước đi hợp lệ.
4. **Hòa cờ:**
   * Trận đấu vượt quá số lượt đi tối đa quy định (mặc định 300 – 500 nước) mà chưa bên nào đạt điều kiện thắng.

---

### 4.4. Quy chuẩn kỹ thuật khi lập trình Agent

Mỗi Agent nộp lên phải là một đoạn mã nguồn Python 3 chứa hàm `agent` với cấu trúc sau:

```python
def agent(observation, configuration):
    """
    Args:
        observation (dict):
            - valid_moves (list[dict]): Danh sách các nước đi hợp lệ ở lượt hiện tại:
                [{"from_col": int, "from_row": int, "to_col": int, "to_row": int, "is_capture": bool}, ...]
            - board (list[dict|None]): Mảng 1 chiều 81 ô (row-major: index = row * 9 + col).
                Mỗi phần tử là None hoặc {"player": 1|2, "type": "ROCK"|"PAPER"|"SCISSORS"}
            - current_player (int): 1 hoặc 2
            - piece_counts (dict): Số lượng quân còn lại của 2 bên:
                {"1": {"ROCK": int, "PAPER": int, "SCISSORS": int}, "2": {...}}
            - move_count (int): Tổng số nước đi đã diễn ra trong ván đấu
        configuration (dict): Các cấu hình bổ sung từ hệ thống (nếu có).

    Returns:
        dict: Nước đi đã chọn dạng:
            {"from_col": int, "from_row": int, "to_col": int, "to_row": int}
        hoặc None (xin đầu hàng).
    """
    moves = observation.get("valid_moves", [])
    if not moves:
        return None
    
    # Chiến thuật ví dụ: Chọn một nước đi bất kỳ
    return moves[0]
```

#### Giới hạn & Ràng buộc môi trường:
* **Ngôn ngữ:** Python 3.10+
* **Thư viện cho phép:** Chỉ được sử dụng các thư viện chuẩn của Python (`math`, `random`, `time`, `collections`, `heapq`, `copy`...). **Không hỗ trợ** các thư viện bên thứ ba như `numpy`, `pandas`, `scipy`...
* **Giới hạn tài nguyên:**
  * Giới hạn thời gian: **10 giây / lượt đi**.
  * Giới hạn dung lượng mã nguồn: Tối đa **65,536 ký tự** (~64 KB).
  * Bộ nhớ: Giới hạn bởi cấu hình container của Judge0 (~128MB RAM).


---

## 5. Hướng dẫn khởi chạy nhanh

### Khởi động toàn bộ dịch vụ (Local Dev):
```bash
# Cài đặt ban đầu
./setup.sh

# Chạy toàn bộ stack (Judge0 + FastAPI Backend + Next.js Frontend)
./start.sh
```

Truy cập:
* **Frontend:** `http://localhost:3000`
* **FastAPI Docs:** `http://localhost:8000/docs`
* **Judge0 Health:** `http://localhost:2358/about`
