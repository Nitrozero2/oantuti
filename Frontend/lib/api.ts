/**
 * API client for OTTv2 FastAPI backend.
 * All calls go through NEXT_PUBLIC_BACKEND_URL (or BACKEND_URL on server).
 */

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchStatus = "pending" | "running" | "finished";

export interface PieceInfo {
  player: number;
  type: "ROCK" | "PAPER" | "SCISSORS";
}

export interface MoveInfo {
  from_col: number;
  from_row: number;
  to_col: number;
  to_row: number;
  from_pos: string;
  to_pos: string;
}

export interface StepResult {
  match_id: string;
  step_number: number;
  player: number;
  move: MoveInfo | null;
  captured: PieceInfo | null;
  game_over: boolean;
  winner: number | null;
  win_reason: string;
  error: string | null;
  agent_stdout: string | null;
}

export interface MatchSummary {
  match_id: string;
  status: MatchStatus;
  current_turn: number;
  move_count: number;
  game_over: boolean;
  winner: number | null;
  win_reason: string;
}

export interface MatchState extends MatchSummary {
  board: (PieceInfo | null)[];
  piece_counts: Record<string, Record<string, number>>;
  valid_moves: Array<{
    from_col: number;
    from_row: number;
    to_col: number;
    to_row: number;
    is_capture: boolean;
  }>;
  history: MoveInfo[];
}

export interface CreateMatchResponse {
  match_id: string;
  status: MatchStatus;
  message: string;
}

export interface RunToEndResponse {
  match_id: string;
  total_moves: number;
  game_over: boolean;
  winner: number | null;
  win_reason: string;
  steps: StepResult[];
  aborted_reason: string | null;
}

export interface HealthResponse {
  status: string;
  judge0_connected: boolean;
  judge0_url: string;
  version: string;
}

// ─── API client ───────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        data: null,
        error: body?.detail ?? `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ─── Matches ──────────────────────────────────────────────────────────────────

export const backendApi = {
  /** Health check */
  health(): Promise<{ data: HealthResponse | null; error: string | null }> {
    return apiFetch<HealthResponse>("/health");
  },

  /** Tạo trận đấu mới */
  createMatch(
    agent1_code: string,
    agent2_code: string,
    max_moves?: number,
  ): Promise<{ data: CreateMatchResponse | null; error: string | null }> {
    return apiFetch<CreateMatchResponse>("/matches/", {
      method: "POST",
      body: JSON.stringify({ agent1_code, agent2_code, max_moves }),
    });
  },

  /** Danh sách tất cả trận đấu */
  listMatches(): Promise<{
    data: { matches: MatchSummary[]; total: number } | null;
    error: string | null;
  }> {
    return apiFetch("/matches/");
  },

  /** Trạng thái chi tiết 1 trận */
  getMatch(
    matchId: string,
  ): Promise<{ data: MatchState | null; error: string | null }> {
    return apiFetch<MatchState>(`/matches/${matchId}`);
  },

  /** Thực hiện 1 nước đi */
  stepMatch(
    matchId: string,
  ): Promise<{ data: StepResult | null; error: string | null }> {
    return apiFetch<StepResult>(`/matches/${matchId}/step`, {
      method: "POST",
    });
  },

  /** Chạy đến khi kết thúc */
  runMatch(
    matchId: string,
  ): Promise<{ data: RunToEndResponse | null; error: string | null }> {
    return apiFetch<RunToEndResponse>(`/matches/${matchId}/run`, {
      method: "POST",
    });
  },

  /** Xóa trận đấu */
  deleteMatch(matchId: string): Promise<{ data: unknown; error: string | null }> {
    return apiFetch(`/matches/${matchId}`, { method: "DELETE" });
  },
};
