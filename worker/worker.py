"""
Worker - Chạy trên máy có Judge0.

Architecture:
  1 worker instance = 1 process, xử lý MAX_CONCURRENT trận song song (asyncio).
  Mỗi trận chạy HOÀN TOÀN LOCAL: engine Python + gọi Judge0 trực tiếp.
  Không cần Redis per nước đi, không HTTP đến backend mỗi nước.

Queue được poll:
  - Unified local-match tasks: POST /worker/tasks/claim

Improvements vs cũ:
  - 0 Redis calls/nước đi (thay vì ~25)
  - Judge0 wait=false + 100ms poll interval (thay vì 500ms)
  - MAX_CONCURRENT mặc định 4 (thay vì 2)
  - Unified engine: 1 worker xử lý cả tournament + friendly

Cấu hình (.env):
  BACKEND_URL           — URL FastAPI
  WORKER_SECRET         — X-Worker-Secret header
  JUDGE0_URL            — URL Judge0 local
  WORKER_ID             — Tên worker (mặc định = hostname)
  MAX_CONCURRENT        — Số trận song song (mặc định 4)
  POLL_INTERVAL         — Giây poll khi queue rỗng (mặc định 1)
  TOURNAMENT_SESSION_ID — Session ID đang active (0 = tắt)
  FRONTEND_URL          — URL callback về Next.js
"""

import asyncio
import json
import logging
import os
import socket
import time
import httpx
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("worker")

# ── Config ────────────────────────────────────────────────────────────────────

BACKEND_URL     = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
WORKER_SECRET   = os.getenv("WORKER_SECRET", "change-me-in-production")
JUDGE0_URL      = os.getenv("JUDGE0_URL", "http://localhost:2358").rstrip("/")
JUDGE0_API_KEY  = os.getenv("JUDGE0_API_KEY", "")
WORKER_ID       = os.getenv("WORKER_ID", socket.gethostname())
MAX_CONCURRENT  = int(os.getenv("MAX_CONCURRENT", "4"))   # tăng từ 2 → 4
POLL_INTERVAL   = float(os.getenv("POLL_INTERVAL", "1"))  # giảm từ 2 → 1
HEARTBEAT_INTERVAL = 30

JUDGE0_LANGUAGE_ID  = int(os.getenv("JUDGE0_LANGUAGE_ID", "71"))
JUDGE0_TIMEOUT      = int(os.getenv("JUDGE0_TIMEOUT_SECONDS", "10"))
JUDGE0_MEMORY_LIMIT = int(os.getenv("JUDGE0_MEMORY_LIMIT_KB", "131072"))

TOURNAMENT_SESSION_ID = int(os.getenv("TOURNAMENT_SESSION_ID", "0")) or None
FRONTEND_URL          = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

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

# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _worker_headers() -> dict:
    return {"X-Worker-Secret": WORKER_SECRET, "Content-Type": "application/json"}

def _judge0_headers() -> dict:
    h = {"Content-Type": "application/json"}
    if JUDGE0_API_KEY:
        h["X-Auth-Token"] = JUDGE0_API_KEY
    return h

# ── Judge0: wait=false + fast polling ────────────────────────────────────────

async def _poll_judge0_fast(client: httpx.AsyncClient, token: str) -> dict:
    """Poll Judge0 với interval 100ms — nhanh hơn 5× so với 500ms cũ."""
    for _ in range(150):  # max 15s
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
    Chạy agent code qua Judge0.
    Trả về dict với các fields:
      success: bool
      move: dict | None
      error: str | None
      is_infra_error: bool  ← True = lỗi Judge0/network (không phải lỗi agent)
                              False = lỗi do code agent (timeout CPU, compile error, bad output)
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
                # Lỗi HTTP từ Judge0 = infra error
                return {"success": False, "move": None, "stdout": "", "stderr": "",
                        "error": f"Judge0 HTTP {r.status_code}: {r.text[:200]}",
                        "is_infra_error": True}

            data = r.json()
            token = data.get("token")

            if data.get("status", {}).get("id", 0) not in (1, 2, 0):
                return _parse_judge0_result(data)

            if not token:
                return {"success": False, "move": None, "stdout": "", "stderr": "",
                        "error": "No token returned from Judge0",
                        "is_infra_error": True}

            result = await _poll_judge0_fast(client, token)
            return _parse_judge0_result(result)

    except httpx.TimeoutException:
        # Timeout kết nối tới Judge0 = infra error
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

    # ── Lỗi hạ tầng Judge0 (is_infra_error=True) ──────────────────────────────
    if status_id == 13:  # Internal Error
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": "Judge0 Internal Error.", "is_infra_error": True}
    if status_id == 0:  # Unknown / not ready
        desc = result.get("status", {}).get("description", "Unknown")
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"Judge0 unexpected status: {desc}", "is_infra_error": True}

    # ── Lỗi do agent (is_infra_error=False) ───────────────────────────────────
    if status_id == 5:  # Time Limit Exceeded
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": "Time limit exceeded.", "is_infra_error": False}
    if status_id == 6:  # Compilation Error
        return {"success": False, "move": None, "stdout": stdout, "stderr": compile_output,
                "error": f"Compilation error: {compile_output[:200]}", "is_infra_error": False}
    if status_id == 11:  # Runtime Error (SIGSEGV, etc.)
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"Runtime error: {stderr[:200]}", "is_infra_error": False}
    if status_id not in (3, 4):  # 3=Accepted, 4=Wrong Answer (dùng cho stdout)
        desc = result.get("status", {}).get("description", "Unknown")
        # Status 7-12 (MLE, OLE, RE...) đều là lỗi agent
        return {"success": False, "move": None, "stdout": stdout, "stderr": stderr,
                "error": f"Judge0 status {status_id}: {desc}", "is_infra_error": False}

    # ── Parse output ───────────────────────────────────────────────────────────
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
    if "from_col" in parsed and "to_col" in parsed:
        try:
            return {k: int(parsed[k]) for k in ("from_col", "from_row", "to_col", "to_row")}
        except (KeyError, ValueError, TypeError):
            return None
    if "from_pos" in parsed and "to_pos" in parsed:
        try:
            def p(pos): return ord(pos[0].lower()) - ord('a'), int(pos[1]) - 1
            fc, fr = p(parsed["from_pos"])
            tc, tr = p(parsed["to_pos"])
            return {"from_col": fc, "from_row": fr, "to_col": tc, "to_row": tr}
        except Exception:
            return None
    return None

# ── Local engine: chạy 1 trận hoàn toàn in-process ───────────────────────────

async def run_match_locally(
    agent1_code: str,
    agent2_code: str,
    max_moves: int = 300,
) -> dict:
    """
    Chạy 1 trận đầy đủ trong worker process.
    - Engine Python local (0 Redis, 0 HTTP/nước đi)
    - 1 Judge0 HTTP call/nước đi (~0.3-0.8s với fast poll)
    Returns: {winner, win_reason, steps}
    """
    from game_engine import OTTGameEngine, Move, COLS, ROWS

    engine = OTTGameEngine()
    steps = []
    agent_error = False

    for move_num in range(max_moves):
        state = engine.state
        if state.game_over:
            break

        current_player = state.current_turn
        agent_code = agent1_code if current_player == 1 else agent2_code

        result = await execute_agent(agent_code, engine.get_observation())

        # ── Lỗi hạ tầng Judge0 → raise để caller xử lý là infra_error ────────
        if result.get("is_infra_error"):
            raise RuntimeError(f"Judge0 infra error: {result['error']}")

        # ── Lỗi do agent (code sai, TLE, CE...) → agent thua ─────────────────
        if not result["success"] or result["move"] is None:
            agent_error = True
            error_msg = result.get("error") or "Agent không trả về nước đi."
            engine.state.game_over = True
            engine.state.winner = 2 if current_player == 1 else 1
            engine.state.win_reason = f"Agent P{current_player} lỗi: {error_msg}"
            steps.append({
                "step_number": move_num + 1, "player": current_player,
                "move": None, "captured": None,
                "game_over": True, "winner": engine.state.winner,
                "win_reason": engine.state.win_reason, "error": error_msg,
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
                "move": None, "captured": None,
                "game_over": True, "winner": engine.state.winner,
                "win_reason": engine.state.win_reason, "error": error_msg,
            })
            break

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
        engine.state.win_reason = f"Đạt giới hạn {max_moves} nước."

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

# ── Backend API helpers ───────────────────────────────────────────────────────

async def send_heartbeat(active_jobs: int) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{BACKEND_URL}/workers/heartbeat",
                json={
                    "worker_id": WORKER_ID, "judge0_url": JUDGE0_URL,
                    "active_jobs": active_jobs, "max_concurrent": MAX_CONCURRENT,
                    "available_slots": max(0, MAX_CONCURRENT - active_jobs),
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


async def claim_next_task() -> dict | None:
    """
    Lấy task tiếp theo từ unified queue.
    Backend tự động lưu task vào active tracking với TTL khi claim.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{BACKEND_URL}/worker/tasks/claim",
                params={"worker_id": WORKER_ID},
                headers=_worker_headers(),
            )
            if r.status_code == 200:
                return r.json().get("task")
    except Exception as e:
        logger.warning(f"claim_next_task error: {e}")
    return None


async def mark_task_done(task_id: str) -> None:
    """Báo backend task hoàn thành → xóa khỏi active tracking."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{BACKEND_URL}/worker/tasks/done",
                json={"worker_id": WORKER_ID, "task_id": task_id},
                headers=_worker_headers(),
            )
    except Exception:
        pass  # Không critical nếu fail — task sẽ tự expire


async def recover_stuck_tasks() -> None:
    """
    Gọi khi worker khởi động để re-enqueue các task bị stuck do crash trước đó.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{BACKEND_URL}/worker/tasks/recover",
                params={"worker_id": WORKER_ID},
                headers=_worker_headers(),
            )
            if r.status_code == 200:
                data = r.json()
                if data.get("recovered", 0) > 0:
                    logger.info(f"Recovered {data['recovered']} stuck task(s) from previous crash")
                if data.get("lost", 0) > 0:
                    logger.warning(f"Lost {data['lost']} task(s) — data expired, cannot recover")
    except Exception as e:
        logger.warning(f"recover_stuck_tasks error: {e}")


async def dispatch_rating_task() -> None:
    """Ask the frontend scheduler for one useful TrueSkill task when capacity exists."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{FRONTEND_URL}/api/rating/dispatch",
                headers=_worker_headers(),
            )
    except Exception as e:
        logger.debug(f"dispatch_rating_task error: {e}")



# ── Callback helpers ──────────────────────────────────────────────────────────

async def _post_callback(url: str, payload: dict, label: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(url, json=payload)
            if r.status_code not in (200, 201):
                logger.warning(f"[{label}] Callback {r.status_code}: {r.text[:200]}")
            else:
                logger.info(f"[{label}] Callback OK")
    except Exception as e:
        logger.error(f"[{label}] Callback failed: {e}")

# ── Tournament task processor ─────────────────────────────────────────────────

async def process_tournament_task(task: dict) -> None:
    match_id    = task["match_id"]        # DB ID
    session_id  = task["session_id"]
    agent1_id   = task["agent1_id"]
    agent2_id   = task["agent2_id"]
    max_moves   = task.get("max_moves", 300)
    callback_url = task.get("callback_url") or FRONTEND_URL
    label = f"Tournament match#{match_id}"

    logger.info(f"[{label}] Starting (session={session_id})")

    # Báo started → DB set status='running'
    await _post_callback(
        f"{callback_url}/api/tournament/match-result",
        {"event": "started", "match_id": match_id, "session_id": session_id,
         "backend_match_id": None, "agent1_id": agent1_id, "agent2_id": agent2_id,
         "outcome": None, "winner_agent_id": None, "win_reason": "",
         "total_moves": 0, "is_infra_error": False, "infra_error_detail": None,
         "moves_history": []},
        label,
    )

    is_infra_error = False
    infra_error_detail = None
    steps = []
    winner = None
    win_reason = ""
    MAX_INFRA_RETRIES = 3

    for attempt in range(1, MAX_INFRA_RETRIES + 1):
        try:
            run = await run_match_locally(task["agent1_code"], task["agent2_code"], max_moves)
            steps = run["steps"]
            winner = run["winner"]
            win_reason = run["win_reason"]
            is_infra_error = False
            break  # thành công
        except RuntimeError as e:
            # Judge0 infra error → retry
            is_infra_error = True
            infra_error_detail = str(e)
            logger.warning(f"[{label}] Infra error (attempt {attempt}/{MAX_INFRA_RETRIES}): {e}")
            if attempt < MAX_INFRA_RETRIES:
                await asyncio.sleep(5 * attempt)  # backoff
        except Exception as e:
            # Unexpected error → không retry
            is_infra_error = True
            infra_error_detail = str(e)
            logger.error(f"[{label}] Unexpected exception: {e}")
            break

    outcome = None
    winner_agent_id = None
    if not is_infra_error:
        if winner == 1: outcome, winner_agent_id = "agent1", agent1_id
        elif winner == 2: outcome, winner_agent_id = "agent2", agent2_id
        else: outcome = "draw"

    moves_history = _build_moves_history(steps)

    # Callback finished
    await _post_callback(
        f"{callback_url}/api/tournament/match-result",
        {"event": "finished", "match_id": match_id, "session_id": session_id,
         "backend_match_id": None, "agent1_id": agent1_id, "agent2_id": agent2_id,
         "outcome": outcome, "winner_agent_id": winner_agent_id,
         "win_reason": win_reason, "total_moves": len(moves_history),
         "is_infra_error": is_infra_error, "infra_error_detail": infra_error_detail,
         "moves_history": moves_history},
        label,
    )

    # Record completed
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{BACKEND_URL}/tournament/sessions/{session_id}/record-completed",
                json={"error": is_infra_error},
                headers=_worker_headers(),
            )
    except Exception:
        pass

    logger.info(f"[{label}] Done: outcome={outcome}, moves={len(moves_history)}")

# ── Friendly task processor ───────────────────────────────────────────────────

async def process_friendly_task(task: dict) -> None:
    fm_id       = task["friendly_match_id"]
    agent1_id   = task.get("agent1_id", 0)
    agent2_id   = task.get("agent2_id", 0)
    max_moves   = task.get("max_moves", 300)
    callback_url = task.get("callback_url") or FRONTEND_URL
    label = f"Friendly match#{fm_id}"

    logger.info(f"[{label}] Starting")

    # Báo started
    await _post_callback(
        f"{callback_url}/api/friendly/result",
        {"event": "started", "friendly_match_id": fm_id},
        label,
    )

    is_infra_error = False
    steps = []
    winner = None
    win_reason = ""
    MAX_INFRA_RETRIES = 3

    for attempt in range(1, MAX_INFRA_RETRIES + 1):
        try:
            run = await run_match_locally(task["agent1_code"], task["agent2_code"], max_moves)
            steps = run["steps"]
            winner = run["winner"]
            win_reason = run["win_reason"]
            is_infra_error = False
            break
        except RuntimeError as e:
            is_infra_error = True
            win_reason = str(e)
            logger.warning(f"[{label}] Infra error (attempt {attempt}/{MAX_INFRA_RETRIES}): {e}")
            if attempt < MAX_INFRA_RETRIES:
                await asyncio.sleep(5 * attempt)
        except Exception as e:
            is_infra_error = True
            win_reason = str(e)
            logger.error(f"[{label}] Unexpected exception: {e}")
            break

    outcome = None
    winner_agent_id = None
    if not is_infra_error:
        if winner == 1: outcome, winner_agent_id = "agent1", agent1_id
        elif winner == 2: outcome, winner_agent_id = "agent2", agent2_id
        else: outcome = "draw"

    moves_history = _build_moves_history(steps)

    # Callback finished
    await _post_callback(
        f"{callback_url}/api/friendly/result",
        {
            "event": "finished",
            "friendly_match_id": fm_id,
            "outcome": outcome,
            "winner_agent_id": winner_agent_id,
            "win_reason": win_reason,
            "total_moves": len(moves_history),
            "is_infra_error": is_infra_error,
            "moves_history": moves_history,
        },
        label,
    )

    logger.info(f"[{label}] Done: outcome={outcome}, moves={len(moves_history)}")


async def process_rating_task(task: dict) -> None:
    rated_match_id = task["rated_match_id"]
    kind = task.get("kind", "rating")
    agent1_id = task["agent1_id"]
    agent2_id = task["agent2_id"]
    max_moves = task.get("max_moves", 300)
    callback_url = task.get("callback_url") or FRONTEND_URL
    label = f"{kind.title()} match#{rated_match_id}"

    await _post_callback(
        f"{callback_url}/api/rating/match-result",
        {"event": "started", "rated_match_id": rated_match_id},
        label,
    )

    is_infra_error = False
    infra_error_detail = None
    steps = []
    winner = None
    win_reason = ""
    agent_error = False
    # Validation retries are persisted in Neon so a worker restart cannot exceed
    # the three-attempt policy. Rating games retain the local retry behavior.
    max_infra_retries = 1 if kind == "validation" else 3
    for attempt in range(1, max_infra_retries + 1):
        try:
            run = await run_match_locally(task["agent1_code"], task["agent2_code"], max_moves)
            steps, winner, win_reason = run["steps"], run["winner"], run["win_reason"]
            agent_error = run.get("agent_error", False)
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

    outcome = "draw"
    if not is_infra_error:
        if winner == 1: outcome = "agent1"
        elif winner == 2: outcome = "agent2"
    else:
        outcome = None
    history = _build_moves_history(steps)
    await _post_callback(
        f"{callback_url}/api/rating/match-result",
        {
            "event": "finished", "rated_match_id": rated_match_id,
            "agent1_id": agent1_id, "agent2_id": agent2_id, "outcome": outcome,
            "winner_agent_id": agent1_id if outcome == "agent1" else agent2_id if outcome == "agent2" else None,
            "win_reason": win_reason, "total_moves": len(history), "is_infra_error": is_infra_error,
            "infra_error_detail": infra_error_detail, "agent_error": agent_error, "moves_history": history,
        },
        label,
    )
    logger.info(f"[{label}] Done: outcome={outcome}, moves={len(history)}")


# ── Main loop ─────────────────────────────────────────────────────────────────

async def process_task(task: dict) -> None:
    """Dispatcher: route task tới handler đúng, đảm bảo mark_task_done luôn được gọi."""
    task_type = task.get("task_type", "unknown")
    task_id = task.get("task_id", "")

    try:
        if task_type == "tournament":
            await process_tournament_task(task)
        elif task_type == "friendly":
            await process_friendly_task(task)
        elif task_type == "rating":
            await process_rating_task(task)
        else:
            logger.error(f"Unknown task_type: {task_type}")
    finally:
        # Luôn mark done dù thành công hay exception
        # → backend xóa khỏi active tracking
        if task_id:
            await mark_task_done(task_id)


# ── Main loop ─────────────────────────────────────────────────────────────────

async def main():
    logger.info(f"Worker {WORKER_ID} starting...")
    logger.info(f"  Backend:    {BACKEND_URL}")
    logger.info(f"  Judge0:     {JUDGE0_URL}")
    logger.info(f"  Concurrent: {MAX_CONCURRENT}")
    logger.info(f"  Frontend:   {FRONTEND_URL}")
    logger.info(f"  Queue:      {BACKEND_URL}/worker/tasks/claim (unified)")

    # ── Chờ Judge0 sẵn sàng trước khi làm bất cứ điều gì ────────────────────
    logger.info("Waiting for Judge0 to be ready...")
    for attempt in range(1, 31):  # tối đa 5 phút (30 × 10s)
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

    active_tasks: dict[str, asyncio.Task] = {}
    last_heartbeat = 0.0
    last_rating_dispatch = 0.0
    last_judge0_check = 0.0
    JUDGE0_CHECK_INTERVAL = 30.0  # check Judge0 mỗi 30s
    judge0_ok = True  # trạng thái hiện tại

    while True:
        now = time.time()

        # Heartbeat
        if now - last_heartbeat >= HEARTBEAT_INTERVAL:
            await send_heartbeat(len(active_tasks))
            last_heartbeat = now

        # Cleanup tasks xong
        for k in [k for k, t in active_tasks.items() if t.done()]:
            task = active_tasks.pop(k)
            if exc := task.exception():
                logger.error(f"Task {k} exception: {exc}")

        # ── Check Judge0 định kỳ ──────────────────────────────────────────────
        if now - last_judge0_check >= JUDGE0_CHECK_INTERVAL:
            was_ok = judge0_ok
            judge0_ok = await check_judge0()
            last_judge0_check = now

            if not judge0_ok and was_ok:
                logger.error(f"⚠️  Judge0 tại {JUDGE0_URL} đã DOWN. Ngừng nhận task mới.")
            elif judge0_ok and not was_ok:
                logger.info(f"✅ Judge0 đã khôi phục. Tiếp tục nhận task.")

        # ── Poll task (chỉ khi Judge0 đang OK) ───────────────────────────────
        if len(active_tasks) < MAX_CONCURRENT:
            if not judge0_ok:
                # Judge0 down → không claim task mới, chờ và retry check sớm hơn
                last_judge0_check = 0.0  # force re-check lần tiếp
                await asyncio.sleep(10)
                continue

            if now - last_rating_dispatch >= 2.0:
                await dispatch_rating_task()
                last_rating_dispatch = now
            task = await claim_next_task()
            if task:
                task_type = task.get("task_type", "unknown")
                tid = f"{task_type}-{task.get('match_id') or task.get('friendly_match_id') or task.get('rated_match_id')}"
                active_tasks[tid] = asyncio.create_task(process_task(task))
                logger.info(f"Claimed {task_type} task {tid}, active={len(active_tasks)}")
            else:
                await asyncio.sleep(POLL_INTERVAL)
        else:
            await asyncio.sleep(0.3)


if __name__ == "__main__":
    asyncio.run(main())
