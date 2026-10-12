"""
Random Agent - Chọn ngẫu nhiên trong số nước đi hợp lệ.

Dùng để test cơ bản. Paste nội dung hàm agent() vào API.

Cách dùng trong API:
    with open("agents/random_agent.py") as f:
        code = f.read()
    # Dùng code này làm agent1_code hoặc agent2_code
"""

import random


def agent(observation, configuration):
    """
    Agent ngẫu nhiên: chọn 1 nước đi hợp lệ bất kỳ.

    Args:
        observation (dict):
            - valid_moves: list nước đi hợp lệ
              [{"from_col": int, "from_row": int, "to_col": int, "to_row": int, "is_capture": bool}]
            - board: list[81] pieces (None hoặc {"player": 1|2, "type": str})
            - current_player: 1 hoặc 2
            - piece_counts: {1: {ROCK:n,...}, 2: {...}}
            - move_count: số nước đã đi
        configuration (dict): cấu hình trận đấu (hiện tại rỗng)

    Returns:
        dict: {"from_col": int, "from_row": int, "to_col": int, "to_row": int}
        hoặc None nếu không có nước đi
    """
    moves = observation.get("valid_moves", [])
    if not moves:
        return None
    move = random.choice(moves)
    return {
        "from_col": move["from_col"],
        "from_row": move["from_row"],
        "to_col": move["to_col"],
        "to_row": move["to_row"],
    }
