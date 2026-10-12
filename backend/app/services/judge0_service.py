"""
Judge0 Service - Thực thi mã Python của agent trong sandbox.

Mỗi lần gọi agent:
1. Tạo submission trên Judge0 với stdin = JSON của observation
2. Chờ kết quả
3. Parse stdout thành nước đi

Agent cần in ra stdout một JSON:
    {"from_col": 2, "from_row": 4, "to_col": 2, "to_row": 5}
hoặc:
    {"from_pos": "c5", "to_pos": "c6"}
"""

import json
import asyncio
import httpx
import logging
from typing import Optional

from ..config import get_settings

logger = logging.getLogger(__name__)


# Template code bao ngoài agent code để:
# 1. Đọc observation từ stdin (JSON)
# 2. Gọi hàm agent()
# 3. In kết quả ra stdout dạng JSON
AGENT_WRAPPER_TEMPLATE = '''
import json
import sys

# ─── Agent code (inject từ người dùng) ───────────────────────────────────────
__AGENT_CODE_PLACEHOLDER__
# ─────────────────────────────────────────────────────────────────────────────

def main():
    raw = sys.stdin.read().strip()
    data = json.loads(raw)
    observation = data["observation"]
    configuration = data.get("configuration", {})

    result = agent(observation, configuration)

    if result is None:
        print(json.dumps(None))
        return

    # Hỗ trợ 2 format:
    # 1. Dict: {"from_col":..., "to_col":...} hoặc {"from_pos":..., "to_pos":...}
    # 2. List/tuple: [from_col, from_row, to_col, to_row]
    if isinstance(result, (list, tuple)) and len(result) == 4:
        move = {
            "from_col": int(result[0]),
            "from_row": int(result[1]),
            "to_col": int(result[2]),
            "to_row": int(result[3]),
        }
    elif isinstance(result, dict):
        move = result
    else:
        print(json.dumps({"error": f"Invalid return type: {type(result)}"}))
        return

    print(json.dumps(move))

if __name__ == "__main__":
    main()
'''


class Judge0Service:
    """Thực thi agent code qua Judge0 API."""

    def __init__(self):
        self.settings = get_settings()
        self._base_url = self.settings.judge0_url.rstrip("/")
        self._headers = {"Content-Type": "application/json"}
        if self.settings.judge0_api_key:
            self._headers["X-Auth-Token"] = self.settings.judge0_api_key

    async def check_connection(self) -> bool:
        """Kiểm tra kết nối đến Judge0."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{self._base_url}/about",
                    headers=self._headers
                )
                return resp.status_code == 200
        except Exception as e:
            logger.warning(f"Judge0 connection check failed: {e}")
            return False

    async def execute_agent(
        self,
        agent_code: str,
        observation: dict,
        configuration: dict = None,
    ) -> dict:
        """
        Thực thi agent code với observation cho trước.

        Trả về:
        {
            "success": bool,
            "move": dict | None,   # {from_col, from_row, to_col, to_row}
            "stdout": str,
            "stderr": str,
            "error": str | None,
        }
        """
        if configuration is None:
            configuration = {}

        wrapped_code = AGENT_WRAPPER_TEMPLATE.replace("__AGENT_CODE_PLACEHOLDER__", agent_code)

        stdin_data = json.dumps({
            "observation": observation,
            "configuration": configuration,
        })

        submission_payload = {
            "language_id": self.settings.judge0_language_id,
            "source_code": wrapped_code,
            "stdin": stdin_data,
            "cpu_time_limit": self.settings.judge0_timeout_seconds,
            "memory_limit": self.settings.judge0_memory_limit_kb,
            "wall_time_limit": self.settings.judge0_timeout_seconds + 2,
        }

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(30.0)
            ) as client:
                # Tạo submission (wait=true để chờ kết quả luôn nếu Judge0 hỗ trợ)
                create_resp = await client.post(
                    f"{self._base_url}/submissions?wait=true",
                    json=submission_payload,
                    headers=self._headers,
                )

                if create_resp.status_code not in (200, 201):
                    return {
                        "success": False,
                        "move": None,
                        "stdout": "",
                        "stderr": "",
                        "error": f"Judge0 HTTP {create_resp.status_code}: {create_resp.text[:200]}",
                    }

                result = create_resp.json()

                # Nếu Judge0 không hỗ trợ wait=true, poll kết quả
                if "token" in result and result.get("status", {}).get("id", 0) in (1, 2):
                    result = await self._poll_submission(client, result["token"])

                return self._parse_result(result)

        except httpx.TimeoutException:
            return {
                "success": False,
                "move": None,
                "stdout": "",
                "stderr": "",
                "error": "Timeout khi gọi Judge0.",
            }
        except Exception as e:
            logger.error(f"Judge0 execute error: {e}", exc_info=True)
            return {
                "success": False,
                "move": None,
                "stdout": "",
                "stderr": "",
                "error": f"Lỗi kết nối Judge0: {str(e)}",
            }

    async def _poll_submission(self, client: httpx.AsyncClient, token: str) -> dict:
        """Poll Judge0 cho đến khi có kết quả."""
        max_attempts = 20
        for _ in range(max_attempts):
            await asyncio.sleep(0.5)
            resp = await client.get(
                f"{self._base_url}/submissions/{token}",
                headers=self._headers,
            )
            if resp.status_code != 200:
                return {"status": {"id": 13, "description": "Internal Error"}}
            data = resp.json()
            status_id = data.get("status", {}).get("id", 0)
            if status_id not in (1, 2):  # 1=In Queue, 2=Processing
                return data
        return {"status": {"id": 13, "description": "Timeout polling"}}

    def _parse_result(self, result: dict) -> dict:
        """Parse kết quả từ Judge0 thành move."""
        status_id = result.get("status", {}).get("id", 0)
        stdout = result.get("stdout") or ""
        stderr = result.get("stderr") or ""
        compile_output = result.get("compile_output") or ""

        # Status IDs Judge0:
        # 3 = Accepted, 4 = Wrong Answer, 5 = Time Limit Exceeded
        # 6 = Compilation Error, 11 = Runtime Error (NZEC), ...
        if status_id == 5:
            return {
                "success": False,
                "move": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": "Agent vượt quá time limit.",
            }
        if status_id == 6:
            return {
                "success": False,
                "move": None,
                "stdout": stdout,
                "stderr": compile_output,
                "error": f"Lỗi biên dịch: {compile_output[:200]}",
            }
        if status_id not in (3, 4):  # Không phải Accepted/Wrong Answer
            desc = result.get("status", {}).get("description", "Unknown")
            return {
                "success": False,
                "move": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": f"Judge0 status {status_id}: {desc}",
            }

        # Parse stdout
        stdout_stripped = stdout.strip()
        if not stdout_stripped:
            return {
                "success": False,
                "move": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": "Agent không trả về kết quả (stdout rỗng).",
            }

        # Lấy dòng cuối cùng có nội dung (bỏ qua print debug)
        lines = [l.strip() for l in stdout_stripped.splitlines() if l.strip()]
        last_line = lines[-1]

        try:
            parsed = json.loads(last_line)
        except json.JSONDecodeError:
            return {
                "success": False,
                "move": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": f"Agent trả về không phải JSON: {last_line[:100]}",
            }

        if parsed is None:
            return {
                "success": True,
                "move": None,  # Agent từ bỏ (resign / no move)
                "stdout": stdout,
                "stderr": stderr,
                "error": None,
            }

        if "error" in parsed:
            return {
                "success": False,
                "move": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": parsed["error"],
            }

        # Normalize move format
        move = self._normalize_move(parsed)
        if move is None:
            return {
                "success": False,
                "move": None,
                "stdout": stdout,
                "stderr": stderr,
                "error": f"Move format không hợp lệ: {parsed}",
            }

        return {
            "success": True,
            "move": move,
            "stdout": stdout,
            "stderr": stderr,
            "error": None,
        }

    def _normalize_move(self, parsed: dict) -> Optional[dict]:
        """
        Chuẩn hóa nước đi về format {from_col, from_row, to_col, to_row}.
        Hỗ trợ:
        - {"from_col": 2, "from_row": 4, "to_col": 2, "to_row": 5}
        - {"from_pos": "c5", "to_pos": "c6"}
        """
        if "from_col" in parsed and "to_col" in parsed:
            try:
                return {
                    "from_col": int(parsed["from_col"]),
                    "from_row": int(parsed["from_row"]),
                    "to_col": int(parsed["to_col"]),
                    "to_row": int(parsed["to_row"]),
                }
            except (KeyError, ValueError, TypeError):
                return None

        if "from_pos" in parsed and "to_pos" in parsed:
            try:
                def parse_pos(pos: str):
                    col = ord(pos[0].lower()) - ord('a')
                    row = int(pos[1]) - 1
                    return col, row
                fc, fr = parse_pos(parsed["from_pos"])
                tc, tr = parse_pos(parsed["to_pos"])
                return {"from_col": fc, "from_row": fr, "to_col": tc, "to_row": tr}
            except Exception:
                return None

        return None
