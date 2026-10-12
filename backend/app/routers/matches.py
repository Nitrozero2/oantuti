"""
Router: /matches - Quản lý trận đấu OTTv2.
"""

from fastapi import APIRouter, HTTPException, Depends

from ..models import (
    CreateMatchRequest,
    CreateMatchResponse,
    MatchState,
    MatchSummary,
    ListMatchesResponse,
    StepResult,
    RunToEndResponse,
    MatchStatus,
)
from ..services.match_service import MatchService, get_match_service

router = APIRouter(prefix="/matches", tags=["Matches"])


@router.post("/", response_model=CreateMatchResponse, summary="Tạo trận đấu mới")
def create_match(
    req: CreateMatchRequest,
    service: MatchService = Depends(get_match_service),
):
    """
    Tạo trận đấu mới từ mã nguồn của hai agent.

    - **agent1_code**: Mã Python của agent 1 (Player 1, đi trước, chiều i9)
    - **agent2_code**: Mã Python của agent 2 (Player 2, chiều a1)
    - **max_moves**: Giới hạn số nước (tùy chọn, mặc định 500)

    Hàm agent cần có signature:
    ```python
    def agent(observation, configuration):
        # observation["valid_moves"]: list nước đi hợp lệ
        # observation["board"]: board phẳng 81 phần tử
        # observation["current_player"]: 1 hoặc 2
        return {"from_col": ..., "from_row": ..., "to_col": ..., "to_row": ...}
    ```
    """
    match = service.create_match(
        agent1_code=req.agent1_code,
        agent2_code=req.agent2_code,
        max_moves=req.max_moves,
    )
    return CreateMatchResponse(
        match_id=match.match_id,
        status=match.status,
        message=f"Trận đấu {match.match_id} đã được tạo. Dùng /matches/{match.match_id}/step để đi từng nước.",
    )


@router.get("/", response_model=ListMatchesResponse, summary="Danh sách trận đấu")
def list_matches(service: MatchService = Depends(get_match_service)):
    """Lấy danh sách tất cả trận đấu."""
    matches = service.list_matches()
    summaries = [MatchSummary(**m.to_summary_dict()) for m in matches]
    return ListMatchesResponse(matches=summaries, total=len(summaries))


@router.get("/{match_id}", response_model=MatchState, summary="Trạng thái trận đấu")
def get_match(
    match_id: str,
    service: MatchService = Depends(get_match_service),
):
    """
    Lấy trạng thái hiện tại của trận đấu, bao gồm:
    - Bàn cờ (board 9x9)
    - Lượt hiện tại
    - Số quân còn lại
    - Danh sách nước đi hợp lệ
    - Lịch sử nước đi
    """
    match = service.get_match(match_id)
    if not match:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy trận đấu {match_id}")
    return MatchState(**match.to_state_dict())


@router.post("/{match_id}/step", response_model=StepResult, summary="Thực hiện 1 nước đi")
async def step_match(
    match_id: str,
    service: MatchService = Depends(get_match_service),
):
    """
    Thực hiện 1 nước đi trong trận đấu:
    1. Lấy observation hiện tại
    2. Gọi agent tương ứng qua Judge0
    3. Áp dụng nước đi
    4. Trả về kết quả

    Trả về nước đi, quân bị ăn (nếu có), và trạng thái kết thúc.
    """
    match = service.get_match(match_id)
    if not match:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy trận đấu {match_id}")

    result = await service.step(match_id)
    return result


@router.post("/{match_id}/run", response_model=RunToEndResponse, summary="Chạy đến khi kết thúc")
async def run_match(
    match_id: str,
    service: MatchService = Depends(get_match_service),
):
    """
    Chạy trận đấu đến khi kết thúc (hoặc đạt giới hạn nước).

    **Cảnh báo:** Endpoint này có thể mất nhiều thời gian tùy thuộc vào
    số nước đi và thời gian thực thi mỗi agent trên Judge0.
    Mỗi nước đi cần ~1-2 giây (round-trip Judge0).

    Nên dùng `/step` lặp lại từ frontend để có UX tốt hơn.
    """
    match = service.get_match(match_id)
    if not match:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy trận đấu {match_id}")

    result = await service.run_to_end(match_id)
    return RunToEndResponse(**result)


@router.delete("/{match_id}", summary="Xóa trận đấu")
def delete_match(
    match_id: str,
    service: MatchService = Depends(get_match_service),
):
    """Xóa trận đấu khỏi bộ nhớ."""
    deleted = service.delete_match(match_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy trận đấu {match_id}")
    return {"message": f"Đã xóa trận đấu {match_id}"}
