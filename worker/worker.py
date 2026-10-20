"""
Worker — Chạy trên máy có Judge0.

Architecture:
  1 worker instance = 1 process, xử lý MAX_CONCURRENT trận song song (asyncio).
  Mỗi trận chạy HOÀN TOÀN LOCAL: engine Python + gọi Judge0 trực tiếp.
  Không cần Redis per nước đi, không HTTP đến backend mỗi nước.

Hai loại trận:
  - rating / validation: TrueSkill continuous rating
  - friendly: trận bạn bè, không ảnh hưởng rating

Cấu hình (.env):
  BACKEND_URL             — URL FastAPI backend
  WORKER_SECRET           — X-Worker-Secret header cho backend
  WORKER_CALLBACK_SECRET  — X-Worker-Callback-Secret header cho Next.js callback
  JUDGE0_URL              — URL Judge0 local
  JUDGE0_API_KEY          — API key cho Judge0 (để trống nếu không cần)
  WORKER_ID               — Tên worker (mặc định = hostname)
  MAX_CONCURRENT          — Số trận song song (mặc định 4)
  POLL_INTERVAL           — Giây poll khi queue rỗng (mặc định 1)
  FRONTEND_URL            — URL Next.js để callback kết quả (KHÔNG có đường dẫn con)
"""

import asyncio
import json
import logging
import os
import socket
import time
import uuid
import httpx
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("worker")

# ── Config ────────────────────────────────────────────────────────────────────

BACKEND_URL              = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
WORKER_SECRET            = os.getenv("WORKER_SECRET", "")
WORKER_CALLBACK_SECRET   = os.getenv("WORKER_CALLBACK_SECRET", "")
JUDGE0_URL               = os.getenv("JUDGE0_URL", "http://localhost:2358").rstrip("/")
JUDGE0_API_KEY           = os.getenv("JUDGE0_API_KEY", "")
FRONTEND_URL             = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# machine_id = hostname, ổn định qua restart — dùng làm key active_list và heartbeat
# instance_id = uuid mới mỗi lần process khởi động — embed trong delivery_id
# → Worker cũ crash rồi restart: cùng machine_id nhưng khác instance_id
#   → delivery_id khác → renew/ACK của instance cũ bị fencing từ chối
MACHINE_ID     = os.getenv('OTT_MANAGED_WORKER_ID') or os.getenv("WORKER_ID") or socket.gethostname()
_INSTANCE_UUID = uuid.uuid4().hex[:12]   # unique per process

# delivery_id counter — tăng mỗi lần claim để đảm bảo uniqueness
_delivery_counter = 0

def _new_delivery_id() -> str:
    global _delivery_counter
    _delivery_counter += 1
    return f"{_INSTANCE_UUID}:{_delivery_counter}"

MAX_CONCURRENT     = int(os.getenv("MAX_CONCURRENT", "4"))
POLL_INTERVAL      = float(os.getenv("POLL_INTERVAL", "1"))
HEARTBEAT_INTERVAL = 30     # giây
LEASE_RENEW_INTERVAL = 120  # giây — phải khớp với LEASE_RENEW_INTERVAL ở backend
REAPER_INTERVAL    = 60     # giây — background reaper chạy mỗi 60s

JUDGE0_LANGUAGE_ID   = int(os.getenv("JUDGE0_LANGUAGE_ID", "71"))
JUDGE0_TIMEOUT       = int(os.getenv("JUDGE0_TIMEOUT_SECONDS", "10"))
JUDGE0_MEMORY_LIMIT  = int(os.getenv("JUDGE0_MEMORY_LIMIT_KB", "131072"))

# ── Fail-fast nếu thiếu secrets ───────────────────────────────────────────────

_INSECURE = {"change-me-in-production", "your-secret-here", "secret", ""}

def _validate_config() -> None:
    errors = []
    if WORKER_SECRET in _INSECURE:
        errors.append("WORKER_SECRET chưa được đặt hoặc dùng giá trị mẫu.")
    if WORKER_CALLBACK_SECRET in _INSECURE:
        errors.append("WORKER_CALLBACK_SECRET chưa được đặt hoặc dùng giá trị mẫu.")
    if not FRONTEND_URL or FRONTEND_URL in {"http://localhost:3000"}:
        logger.warning("FRONTEND_URL đang dùng localhost — chỉ phù hợp cho dev.")
    if errors:
        for e in errors:
            logger.error(f"Config error: {e}")
        raise SystemExit(1)

# ── Agent wrapper ─────────────────────────────────────────────────────────────

AGENT_WRAPPER = '''
import json, sys

__AGENT_CODE_PLACEHOLDER__

def main():
    data = json.loads(sys.stdin.read().strip())
    result = agent(data["observation"], data.get("configuration", {}))
    if result is None:
        print(json.dumps(None)); return
    if isinstance(result, (list, tuple)) and len(result) == 4:
        result = {"from_col": int(result[0]), "from_row": int(result[1]),
                  "to_col": int(result[2]), "to_row": int(result[3])}
    print(json.dumps(result))

if __name__ == "__main__":
    main()
'''

# ── HTTP headers ──────────────────────────────────────────────────────────────

def _worker_headers() -> dict:
    """Headers cho backend (FastAPI) calls."""
    return {"X-Worker-Secret": WORKER_SECRET, "Content-Type": "application/json"}


def _runtime_scope() -> dict:
    return {'runtime_id': os.getenv('OTT_RUNTIME_ID', ''),
            'instance_id': os.getenv('OTT_SUPERVISOR_INSTANCE', ''),
            'generation': int(os.getenv('OTT_SUPERVISOR_GENERATION', '0'))}


def _callback_headers() -> dict:
    """Headers cho frontend (Next.js) callback calls."""
    return {"X-Worker-Callback-Secret": WORKER_CALLBACK_SECRET, "Content-Type": "application/json"}


def _judge0_headers() -> dict:
    h = {"Content-Type": "application/json"}
    if JUDGE0_API_KEY:
        h["X-Auth-Token"] = JUDGE0_API_KEY
    return h

# ── Judge0: async submit + fast poll ─────────────────────────────────────────

async def _poll_judge0_fast(client: httpx.AsyncClient, token: str) -> dict:
    """Poll Judge0 mỗi 100ms, tối đa 15s."""
    for _ in range(150):
        await asyncio.sleep(0.1)
        try:
            resp = await client.get(
                f"{JUDGE0_URL}/submissions/{token}",
                headers=_judge0_headers(),
            )
            if resp.status_code != 200:
                return {"status": {"id": 13, "description": "HTTP error"}}
            data = resp.json()
            if data.get("status", {}).get("id", 0) not in (1, 2):
                return data
        except Exception:
            continue
    return {"status": {"id": 13, "description": "Timeout"}}


async def execute_agent(agent_code: str, observation: dict) -> dict:
    """
    Chạy agent code qua Judge0. Trả về:
      {success, move, stdout, stderr, error, is_infra_error}
    is_infra_error=True → lỗi Judge0/network (nên retry)
    is_infra_error=False → lỗi code agent (agent thua, không retry)
    """
    wrapped = AGENT_WRAPPER.replace("__AGENT_CODE_PLACEHOLDER__", agent_code)
    stdin = json.dumps({"observation": observation, "configuration": {}})
    payload = {
        "language_id": JUDGE0_LANGUAGE_ID,
        "source_code": wrapped,
        "stdin": stdin,
        "cpu_time_limit": JUDGE0_TIMEOUT,
        "memory_limit": JUDGE0_MEMORY_LIMIT,
        "wall_time_limit": JUDGE0_TIMEOUT + 2,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            r = await client.post(
                f"{JUDGE0_URL}/submissions",
                json=payload,
                headers=_judge0_headers(),
            )
            if r.status_code not in (200, 201):
                return {"success": False, "move": None, "stdout": "", "stderr": "",
                        "error": f"Judge0 HTTP {r.status_code}: {r.text[:200]}",
                        "is_infra_error": True}

            data = r.json()
            token = data.get("token")
            if data.get("status", {}).get("id", 0) not in (1, 2, 0):
                return _parse_judge0_result(data)
            if not token:
                return {"success": False, "move": None, "stdout": "", "stderr": "",
                        "error": "No token returned from Judge0", "is_infra_error": True}

            result = await _poll_judge0_fast(client, token)
            return _parse_judge0_result(result)

    except httpx.TimeoutException:
        return {"success": False, "move": None, "stdout": "", "stderr": "",
                "error": "Judge0 connection timeout.", "is_infra_error": True}
    except Exception as e:
        return {"success": False, "move": None, "stdout": "", "stderr": "",
                "error": str(e), "is_infra_error": True}


def _parse_judge0_result(result: dict) -> dict:
    status_id = result.get("status", {}).get("id", 0)
    stdout = result.get("stdout") or ""
    stderr = result.get("stderr") or ""
    compile_output = result.get("compile_output") or ""

    if status_id == 13:
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": "Judge0 Internal Error.", "is_infra_error": True}
    if status_id == 0:
        desc = result.get("status", {}).get("description", "Unknown")
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"Judge0 unexpected status: {desc}", "is_infra_error": True}
    if status_id == 5:
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": "Time limit exceeded.", "is_infra_error": False}
    if status_id == 6:
        return {"success": False, "move": None, "stdout": stdout, "stderr": compile_output,
                "error": f"Compilation error: {compile_output[:200]}", "is_infra_error": False}
    if status_id == 11:
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"Runtime error: {stderr[:200]}", "is_infra_error": False}
    if status_id not in (3, 4):
        desc = result.get("status", {}).get("description", "Unknown")
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"Judge0 status {status_id}: {desc}", "is_infra_error": False}

    lines = [l.strip() for l in stdout.strip().splitlines() if l.strip()]
    if not lines:
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": "stdout rỗng.", "is_infra_error": False}

    try:
        parsed = json.loads(lines[-1])
    except json.JSONDecodeError:
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"JSON parse error: {lines[-1][:100]}", "is_infra_error": False}

    if parsed is None:
        return {"success": True, "move": None, "stdout": stdout, "stderr": stderr,
                "error": None, "is_infra_error": False}
    if not isinstance(parsed, dict):
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": "Agent phải trả về object nước đi.", "is_infra_error": False}
    if "error" in parsed:
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": parsed["error"], "is_infra_error": False}

    move = _normalize_move(parsed)
    if move is None:
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"Move format không hợp lệ: {parsed}", "is_infra_error": False}
    return {"success": True, "move": move, "stdout": stdout, "stderr": stderr,
            "error": None, "is_infra_error": False}


def _normalize_move(parsed: dict):
    if not isinstance(parsed, dict):
        return None
    if "from_col" in parsed and "to_col" in parsed:
        try:
            move = {k: parsed[k] for k in ("from_col", "from_row", "to_col", "to_row")}
            if any(type(value) is not int or not 0 <= value < 9 for value in move.values()):
                return None
            return move
        except (KeyError, ValueError, TypeError):
            return None
    if "from_pos" in parsed and "to_pos" in parsed:
        try:
            def p(pos):
                if not isinstance(pos, str) or len(pos) != 2 or pos[0].lower() not in "abcdefghi" or pos[1] not in "123456789":
                    raise ValueError("Invalid position")
                return ord(pos[0].lower()) - ord("a"), int(pos[1]) - 1
            fc, fr = p(parsed["from_pos"])
            tc, tr = p(parsed["to_pos"])
            return {"from_col": fc, "from_row": fr, "to_col": tc, "to_row": tr}
        except Exception:
            return None
    return None

# ── Local engine ──────────────────────────────────────────────────────────────

VALIDATION_MAX_MOVES = 60
MATCH_MAX_MOVES = 150


def match_move_limit(kind: str, requested=None) -> int:
    cap = VALIDATION_MAX_MOVES if kind == 'validation' else MATCH_MAX_MOVES
    return min(requested, cap) if type(requested) is int and requested > 0 else cap


def position_key(state) -> tuple:
    # Turn matters; move_count/history do not alter the legal moves of a position.
    return (state.current_turn, tuple(
        (piece.player, piece.type) if piece else None
        for row in state.board for piece in row
    ))


async def run_match_locally(
    agent1_code: str,
    agent2_code: str,
    max_moves: int = MATCH_MAX_MOVES,
) -> dict:
    """Chạy trận đầy đủ in-process. Raises RuntimeError nếu lỗi hạ tầng Judge0."""
    from game_engine import OTTGameEngine, Move, COLS, ROWS

    engine = OTTGameEngine()
    steps = []
    agent_error = False
    positions = {position_key(engine.state): 1}

    for move_num in range(max_moves):
        state = engine.state
        if state.game_over:
            break

        current_player = state.current_turn
        agent_code = agent1_code if current_player == 1 else agent2_code
        result = await execute_agent(agent_code, engine.get_observation())

        if result.get("is_infra_error"):
            raise RuntimeError(f"Judge0 infra error: {result['error']}")

        if not result["success"] or result["move"] is None:
            agent_error = True
            error_msg = result.get("error") or "Agent không trả về nước đi."
            engine.state.game_over = True
            engine.state.winner = 2 if current_player == 1 else 1
            engine.state.win_reason = f"Agent P{current_player} lỗi: {error_msg}"
            steps.append({
                "step_number": move_num + 1, "player": current_player,
                "move": None, "captured": None, "game_over": True,
                "winner": engine.state.winner, "win_reason": engine.state.win_reason,
                "error": error_msg,
            })
            break

        move = Move(
            from_col=result["move"]["from_col"], from_row=result["move"]["from_row"],
            to_col=result["move"]["to_col"], to_row=result["move"]["to_row"],
        )
        apply = engine.apply_move(move)

        if not apply["success"]:
            agent_error = True
            error_msg = apply.get("error") or "Nước đi không hợp lệ."
            engine.state.game_over = True
            engine.state.winner = 2 if current_player == 1 else 1
            engine.state.win_reason = f"Agent P{current_player} nước không hợp lệ: {error_msg}"
            steps.append({
                "step_number": move_num + 1, "player": current_player,
                "move": None, "captured": None, "game_over": True,
                "winner": engine.state.winner, "win_reason": engine.state.win_reason,
                "error": error_msg,
            })
            break

        if not apply["game_over"]:
            key = position_key(engine.state)
            positions[key] = positions.get(key, 0) + 1
            if positions[key] >= 3:
                engine.state.game_over = True
                engine.state.winner = None
                engine.state.win_reason = 'Hòa: cùng thế cờ và bên tới lượt lặp lại lần thứ 3.'
                apply.update(game_over=True, winner=None, win_reason=engine.state.win_reason)

        captured = apply.get("captured")
        steps.append({
            "step_number": move_num + 1,
            "player": current_player,
            "move": {
                "from_col": move.from_col, "from_row": move.from_row,
                "to_col": move.to_col, "to_row": move.to_row,
                "from_pos": f"{COLS[move.from_col]}{ROWS[move.from_row]}",
                "to_pos": f"{COLS[move.to_col]}{ROWS[move.to_row]}",
            },
            "captured": {"type": captured["type"], "player": captured["player"]} if captured else None,
            "game_over": apply["game_over"],
            "winner": apply.get("winner"),
            "win_reason": apply.get("win_reason", ""),
            "error": None,
        })
        if apply["game_over"]:
            break
    else:
        engine.state.game_over = True
        engine.state.winner = None
        engine.state.win_reason = f"Đạt giới hạn {max_moves} nước."
        if steps:
            steps[-1].update(game_over=True, winner=None, win_reason=engine.state.win_reason)

    return {
        "winner": engine.state.winner,
        "win_reason": engine.state.win_reason,
        "steps": steps,
        "agent_error": agent_error,
    }


def _build_moves_history(steps: list) -> list:
    history = []
    for s in steps:
        mv = s.get("move")
        if mv:
            history.append({
                "move_number": s["step_number"],
                "player": s["player"],
                "from_col": mv["from_col"], "from_row": mv["from_row"],
                "to_col": mv["to_col"], "to_row": mv["to_row"],
                "from_pos": mv["from_pos"], "to_pos": mv["to_pos"],
                "piece_type": None,
                "captured_type": s["captured"]["type"] if s.get("captured") else None,
            })
    return history

# ── Callback with retry — non-ACK on failure ─────────────────────────────────

async def _post_callback_with_retry(
    url: str, payload: dict, label: str
) -> tuple[bool, int, dict]:
    """
    POST callback tới frontend. Retry với exponential backoff.
    Returns (ok, status_code, body_dict).

    ok=True  → HTTP 2xx (kể cả duplicate:true).
    ok=False → thất bại sau tất cả retries, 401, hoặc 409 (không retry 409).

    409 = conflict (another worker owns this match) → caller nên dừng, không retry.
    401 = auth failure → config sai → không retry.
    5xx → retry với backoff.
    """
    delays = [0, 5, 15, 30]
    for attempt, delay in enumerate(delays, 1):
        if delay > 0:
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(url, json=payload, headers=_callback_headers())
                body: dict = {}
                try:
                    body = r.json()
                except Exception:
                    pass

                if r.status_code in (200, 201):
                    logger.info(f"[{label}] Callback OK (attempt {attempt})")
                    return True, r.status_code, body

                elif r.status_code == 401:
                    logger.error(
                        f"[{label}] Callback 401 — check WORKER_CALLBACK_SECRET. NOT ACKing."
                    )
                    return False, 401, body

                elif r.status_code == 409:
                    # Conflict: another worker owns this match. Do NOT retry.
                    reason = body.get("reason", "conflict")
                    logger.warning(
                        f"[{label}] Callback 409 ({reason}) — stopping, will NOT ACK."
                    )
                    return False, 409, body

                else:
                    logger.warning(
                        f"[{label}] Callback {r.status_code} "
                        f"(attempt {attempt}/{len(delays)}): {r.text[:200]}"
                    )
        except Exception as e:
            logger.error(
                f"[{label}] Callback exception (attempt {attempt}/{len(delays)}): {e}"
            )

    logger.error(f"[{label}] All retries exhausted. NOT ACKing.")
    return False, 0, {}

# ── Backend API helpers ───────────────────────────────────────────────────────

async def send_heartbeat(active_jobs: int, active_task_ids: list | None = None) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{BACKEND_URL}/workers/heartbeat",
                json={
                    "worker_id": MACHINE_ID,
                    "judge0_url": JUDGE0_URL,
                    "active_jobs": active_jobs,
                    "max_concurrent": MAX_CONCURRENT,
                    "available_slots": max(0, MAX_CONCURRENT - active_jobs),
                    "active_task_ids": active_task_ids or [],
                    "timestamp": time.time(),
                },
                headers=_worker_headers(),
            )
    except Exception:
        pass


async def check_judge0() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{JUDGE0_URL}/about", headers=_judge0_headers())
            return r.status_code == 200
    except Exception:
        return False


async def claim_next_task() -> tuple[dict | None, str | None]:
    """
    Atomic claim. Returns (task_dict, delivery_id) hoặc (None, None).
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{BACKEND_URL}/worker/tasks/claim",
                params={"machine_id": MACHINE_ID, **_runtime_scope()},
                headers=_worker_headers(),
            )
            if r.status_code == 200:
                data = r.json()
                task = data.get("task")
                delivery_id = data.get("delivery_id")
                if task and delivery_id:
                    return task, delivery_id
    except Exception as e:
        logger.warning(f"claim_next_task error: {e}")
    return None, None


async def ack_task(task_id: str, delivery_id: str) -> None:
    """
    ACK task — chỉ gọi sau khi callback đã thành công.
    Fenced bởi delivery_id: worker cũ không thể ACK lease của instance mới.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{BACKEND_URL}/worker/tasks/ack",
                json={"machine_id": MACHINE_ID, "task_id": task_id, "delivery_id": delivery_id, **_runtime_scope()},
                headers=_worker_headers(),
            )
    except Exception:
        pass  # Non-critical: lease tự expire sau LEASE_TTL nếu ACK fail


async def renew_task_lease(task_id: str, delivery_id: str) -> bool | None:
    """
    Gia hạn lease. Fenced bởi delivery_id.
    Returns False nếu lease gone hoặc delivery_id không khớp.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{BACKEND_URL}/worker/tasks/renew",
                json={"machine_id": MACHINE_ID, "task_id": task_id, "delivery_id": delivery_id, **_runtime_scope()},
                headers=_worker_headers(),
            )
            if r.status_code == 200:
                return r.json().get("ok", False)
    except Exception as e:
        logger.warning(f"renew_task_lease error ({task_id}): {e}")
    # Network failure is not proof of fencing; retry on the next renewal.
    return None


async def trigger_reap() -> None:
    """Background reaper — gọi /tasks/reap mỗi REAPER_INTERVAL giây."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(f"{BACKEND_URL}/worker/tasks/reap", headers=_worker_headers())
            if r.status_code == 200:
                data = r.json()
                if data.get("reaped", 0) or data.get("lost", 0):
                    logger.info(
                        f"Reaper: {data.get('checked', 0)} checked, "
                        f"{data.get('reaped', 0)} re-enqueued, "
                        f"{data.get('lost', 0)} lost"
                    )
                if data.get("lost", 0) > 0:
                    await _reset_lost_db()
    except Exception as e:
        logger.debug(f"trigger_reap error: {e}")


async def _reset_lost_db() -> None:
    """Reset DB records của lost tasks về scheduled."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{FRONTEND_URL}/api/worker/reset-lost",
                headers=_callback_headers(),
            )
            if r.status_code == 200:
                d = r.json()
                n = d.get("reset_rated", 0) + d.get("reset_friendly", 0)
                if n:
                    logger.info(
                        f"DB reset: {d.get('reset_rated', 0)} rated + "
                        f"{d.get('reset_friendly', 0)} friendly → scheduled"
                    )
    except Exception as e:
        logger.warning(f"_reset_lost_db error: {e}")


async def recover_stuck_tasks() -> None:
    """
    Gọi khi worker khởi động. Re-enqueue tasks trong active_list của machine này.
    Task data expired → lost → gọi DB reset.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{BACKEND_URL}/worker/tasks/recover",
                params={"machine_id": MACHINE_ID},
                headers=_worker_headers(),
            )
            if r.status_code == 200:
                data = r.json()
                if data.get("recovered", 0) > 0:
                    logger.info(f"Recovered {data['recovered']} stuck task(s) — re-enqueued")
                if data.get("lost", 0) > 0:
                    logger.warning(f"Lost {data['lost']} task(s) — data expired. Resetting DB...")
                    await _reset_lost_db()
    except Exception as e:
        logger.warning(f"recover_stuck_tasks error: {e}")


async def dispatch_rating_task() -> float:
    """Yêu cầu frontend tạo thêm trận rating nếu worker có slot trống."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{FRONTEND_URL}/api/rating/dispatch",
                headers=_callback_headers(),
            )
            response.raise_for_status()
            delay = response.json().get('retry_after_seconds', 5)
            return max(5.0, min(60.0, float(delay)))
    except Exception as e:
        logger.debug(f"dispatch_rating_task error: {e}")
        return 15.0

# ── Task processors ───────────────────────────────────────────────────────────

async def process_friendly_task(task: dict, delivery_id: str) -> bool:
    """
    Chạy trận friendly.
    - "started" cấp execution_token → nếu 409 (worker khác đang chạy) → dừng ngay.
    - "finished" gửi kèm execution_token để backend verify fencing.
    Returns True nếu toàn bộ callback thành công.
    """
    fm_id      = task["friendly_match_id"]
    agent1_id  = task.get("agent1_id", 0)
    agent2_id  = task.get("agent2_id", 0)
    max_moves  = match_move_limit('friendly', task.get('max_moves'))
    label = f"Friendly match#{fm_id}"

    logger.info(f"[{label}] Starting (delivery={delivery_id})")

    ok, status, body = await _post_callback_with_retry(
        f"{FRONTEND_URL}/api/friendly/result",
        {"event": "started", "friendly_match_id": fm_id, "delivery_id": delivery_id},
        label,
    )
    if not ok:
        if status == 409 and body.get("reason") == "already_finished":
            return True  # Terminal task: ACK instead of endlessly re-enqueueing.
        if status == 409:
            logger.warning(f"[{label}] Another worker owns this match. Abandoning.")
        return False

    execution_token: str = body.get("execution_token") or delivery_id

    is_infra_error = False
    steps, winner, win_reason = [], None, ""
    MAX_INFRA_RETRIES = 3

    for attempt in range(1, MAX_INFRA_RETRIES + 1):
        try:
            run = await run_match_locally(task["agent1_code"], task["agent2_code"], max_moves)
            steps, winner, win_reason = run["steps"], run["winner"], run["win_reason"]
            is_infra_error = False
            break
        except RuntimeError as e:
            is_infra_error, win_reason = True, str(e)
            logger.warning(f"[{label}] Infra error (attempt {attempt}/{MAX_INFRA_RETRIES}): {e}")
            if attempt < MAX_INFRA_RETRIES:
                await asyncio.sleep(5 * attempt)
        except Exception as e:
            is_infra_error, win_reason = True, str(e)
            logger.error(f"[{label}] Unexpected exception: {e}")
            break

    outcome = winner_agent_id = None
    if not is_infra_error:
        if winner == 1:   outcome, winner_agent_id = "agent1", agent1_id
        elif winner == 2: outcome, winner_agent_id = "agent2", agent2_id
        else:             outcome = "draw"

    moves_history = _build_moves_history(steps)
    ok, _, _ = await _post_callback_with_retry(
        f"{FRONTEND_URL}/api/friendly/result",
        {
            "event": "finished",
            "friendly_match_id": fm_id,
            "delivery_id": delivery_id,
            "execution_token": execution_token,
            "outcome": outcome,
            "winner_agent_id": winner_agent_id,
            "win_reason": win_reason,
            "total_moves": len(moves_history),
            "is_infra_error": is_infra_error,
            "moves_history": moves_history,
        },
        label,
    )
    logger.info(f"[{label}] Done: outcome={outcome}, moves={len(moves_history)}, ok={ok}")
    return ok


async def process_rating_task(task: dict, delivery_id: str) -> bool:
    """
    Chạy trận rating/validation.
    - "started" cấp execution_token → nếu 409 → dừng ngay, không ACK.
    - "finished" gửi kèm execution_token để backend fencing.
    Returns True nếu toàn bộ callback thành công.
    """
    rated_match_id = task["rated_match_id"]
    kind           = task.get("kind", "rating")
    agent1_id      = task["agent1_id"]
    agent2_id      = task["agent2_id"]
    max_moves      = match_move_limit(kind, task.get('max_moves'))
    label = f"{kind.title()} match#{rated_match_id}"

    # ── Bước 1: "started" — nhận execution_token ──────────────────────────
    ok, status, body = await _post_callback_with_retry(
        f"{FRONTEND_URL}/api/rating/match-result",
        {"event": "started", "rated_match_id": rated_match_id, "delivery_id": delivery_id},
        label,
    )
    if not ok:
        if status == 409 and body.get("reason") == "already_finished":
            return True
        if status == 409:
            logger.warning(
                f"[{label}] 409 from started "
                f"(reason={body.get('reason','?')}) — another worker owns this match. "
                f"Abandoning (will NOT ACK lease)."
            )
        return False

    execution_token: str = body.get("execution_token") or delivery_id
    logger.info(f"[{label}] Got execution_token={execution_token}")

    # ── Bước 2: Chạy trận locally ─────────────────────────────────────────
    is_infra_error = False
    infra_error_detail = None
    steps, winner, win_reason, agent_error = [], None, "", False
    max_infra_retries = 1 if kind == "validation" else 3

    for attempt in range(1, max_infra_retries + 1):
        try:
            run = await run_match_locally(task["agent1_code"], task["agent2_code"], max_moves)
            steps, winner, win_reason = run["steps"], run["winner"], run["win_reason"]
            agent_error = run.get("agent_error", False)
            is_infra_error = False
            break
        except RuntimeError as e:
            is_infra_error, infra_error_detail = True, str(e)
            logger.warning(f"[{label}] Infra error ({attempt}/{max_infra_retries}): {e}")
            if attempt < max_infra_retries:
                await asyncio.sleep(5 * attempt)
        except Exception as e:
            is_infra_error, infra_error_detail = True, str(e)
            logger.error(f"[{label}] Unexpected exception: {e}")
            break

    outcome = None
    if not is_infra_error:
        if winner == 1:   outcome = "agent1"
        elif winner == 2: outcome = "agent2"
        else:             outcome = "draw"

    # ── Bước 3: "finished" — gửi kết quả kèm execution_token ─────────────
    history = _build_moves_history(steps)
    ok, _, _ = await _post_callback_with_retry(
        f"{FRONTEND_URL}/api/rating/match-result",
        {
            "event": "finished",
            "rated_match_id": rated_match_id,
            "delivery_id": delivery_id,
            "execution_token": execution_token,
            "agent1_id": agent1_id, "agent2_id": agent2_id,
            "outcome": outcome,
            "winner_agent_id": (agent1_id if outcome == "agent1"
                                else agent2_id if outcome == "agent2" else None),
            "win_reason": win_reason, "total_moves": len(history),
            "is_infra_error": is_infra_error, "infra_error_detail": infra_error_detail,
            "agent_error": agent_error, "moves_history": history,
        },
        label,
    )
    logger.info(f"[{label}] Done: outcome={outcome}, moves={len(history)}, ok={ok}")
    return ok


async def process_task(task: dict, delivery_id: str) -> None:
    """
    Dispatcher. ACK chỉ được gọi nếu callback thành công và delivery_id còn hợp lệ.
    409 từ "started" → không ACK → lease tự expire → reaper re-enqueue.
    """
    task_type = task.get("task_type", "unknown")
    task_id   = task.get("task_id", "")
    lease_renew_task = asyncio.create_task(
        _lease_renewal_loop(task_id, delivery_id, asyncio.current_task())
    )

    try:
        if task_type == "friendly":
            callback_ok = await process_friendly_task(task, delivery_id)
        elif task_type == "rating":
            callback_ok = await process_rating_task(task, delivery_id)
        else:
            logger.error(f"Unknown task_type: {task_type} (task_id={task_id})")
            callback_ok = False
    except Exception as e:
        logger.error(f"process_task unhandled exception (task_id={task_id}): {e}")
        callback_ok = False
    finally:
        lease_renew_task.cancel()
        await asyncio.gather(lease_renew_task, return_exceptions=True)

    if callback_ok and task_id:
        await ack_task(task_id, delivery_id)
    elif task_id:
        logger.warning(
            f"Task {task_id} NOT ACKed (delivery={delivery_id}) "
            f"— lease will expire, reaper will re-enqueue"
        )


async def _lease_renewal_loop(task_id: str, delivery_id: str, owner: asyncio.Task | None = None) -> None:
    """Gia hạn lease định kỳ. Dừng nếu fenced (delivery_id không còn khớp)."""
    while True:
        await asyncio.sleep(LEASE_RENEW_INTERVAL)
        renewed = await renew_task_lease(task_id, delivery_id)
        if renewed is False:
            logger.warning(
                f"Lease renewal failed for {task_id} (delivery={delivery_id}) "
                f"— lease expired or fenced; reaper will handle re-enqueue"
            )
            if owner is not None:
                owner.cancel()
            break


async def _background_reaper() -> None:
    """Background loop: chạy reaper mỗi REAPER_INTERVAL giây."""
    await asyncio.sleep(REAPER_INTERVAL)  # delay trước lần đầu
    while True:
        await trigger_reap()
        await asyncio.sleep(REAPER_INTERVAL)

# ── Main loop ─────────────────────────────────────────────────────────────────

async def main():
    _validate_config()

    logger.info(f"Worker starting — machine_id={MACHINE_ID} instance={_INSTANCE_UUID}")
    logger.info(f"  Backend:    {BACKEND_URL}")
    logger.info(f"  Frontend:   {FRONTEND_URL}")
    logger.info(f"  Judge0:     {JUDGE0_URL}")
    logger.info(f"  Concurrent: {MAX_CONCURRENT}")

    # Chờ Judge0 sẵn sàng
    logger.info("Waiting for Judge0 to be ready...")
    for attempt in range(1, 31):
        if await check_judge0():
            logger.info(f"Judge0 ready ✓ (attempt {attempt})")
            break
        logger.warning(f"Judge0 not ready (attempt {attempt}/30), retrying in 10s...")
        await asyncio.sleep(10)
    else:
        logger.error("Judge0 không sẵn sàng sau 5 phút. Worker tiếp tục nhưng mọi task sẽ fail.")

    # Recover stuck tasks từ lần chạy trước
    logger.info("Checking for stuck tasks from previous run...")
    await recover_stuck_tasks()

    # Map: task_id → asyncio.Task (process coroutine)
    active_tasks: dict[str, asyncio.Task] = {}

    last_heartbeat       = 0.0
    next_rating_dispatch = 0.0
    last_judge0_check    = 0.0
    JUDGE0_CHECK_INTERVAL = 30.0
    judge0_ok = True

    # Background reaper chạy độc lập
    asyncio.create_task(_background_reaper())

    while True:
        now = time.time()

        # Heartbeat
        if now - last_heartbeat >= HEARTBEAT_INTERVAL:
            await send_heartbeat(len(active_tasks), list(active_tasks.keys()))
            last_heartbeat = now

        # Cleanup tasks đã xong
        completed_keys = [k for k, t in active_tasks.items() if t.done()]
        for k in completed_keys:
            t = active_tasks.pop(k)
            if not t.cancelled() and (exc := t.exception()):
                logger.error(f"Task {k} exception: {exc}")

        if completed_keys:
            await send_heartbeat(len(active_tasks), list(active_tasks.keys()))
            last_heartbeat = now

        # Check Judge0 định kỳ
        if now - last_judge0_check >= JUDGE0_CHECK_INTERVAL:
            was_ok = judge0_ok
            judge0_ok = await check_judge0()
            last_judge0_check = now
            if not judge0_ok and was_ok:
                logger.error(f"⚠️  Judge0 tại {JUDGE0_URL} đã DOWN. Ngừng nhận task mới.")
            elif judge0_ok and not was_ok:
                logger.info(f"✅ Judge0 đã khôi phục. Tiếp tục nhận task.")

        # Poll task
        if len(active_tasks) < MAX_CONCURRENT:
            if not judge0_ok:
                last_judge0_check = 0.0
                await asyncio.sleep(10)
                continue

            task, delivery_id = await claim_next_task()
            if task and delivery_id:
                task_id   = task.get("task_id", "")
                task_type = task.get("task_type", "unknown")

                active_tasks[task_id] = asyncio.create_task(
                    process_task(task, delivery_id)
                )
                logger.info(
                    f"Claimed {task_type} task {task_id} "
                    f"(delivery={delivery_id}), active={len(active_tasks)}"
                )
                await send_heartbeat(len(active_tasks), list(active_tasks.keys()))
                last_heartbeat = now
            else:
                if time.monotonic() >= next_rating_dispatch:
                    next_rating_dispatch = time.monotonic() + await dispatch_rating_task()
                await asyncio.sleep(POLL_INTERVAL)
        else:
            await asyncio.sleep(0.3)


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ['--runtime']:
        from runtime import main as runtime_main
        asyncio.run(runtime_main())
    else:
        import supervisor
        supervisor.cli(sys.modules[__name__])
