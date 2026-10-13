import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { backendFetch, isBackendOnline } from "@/lib/backend";

export const runtime = "nodejs";

/**
 * POST /api/friendly/process-pending
 *
 * Worker endpoint: khi backend online, chạy tất cả friendly matches đang pending.
 * Gọi thủ công từ admin, hoặc gọi tự động từ frontend khi phát hiện backend online.
 *
 * Flow mỗi match:
 *   1. Lấy code của 2 agents từ DB
 *   2. Gọi backend POST /matches/ để tạo match
 *   3. Gọi backend POST /matches/{id}/run để chạy đến hết
 *   4. Lưu kết quả + lịch sử nước đi vào DB
 *   5. Update friendly_match: pending_backend=false, status='finished'
 *
 * Returns: { processed: number, errors: number, results: [...] }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  // Chỉ admin hoặc gọi từ client của chính người dùng (match_id specific)
  // Nếu không có body → admin xử lý tất cả; có body.match_id → user kích hoạt 1 trận
  let body: { match_id?: number } = {};
  try { body = (await request.json()) as { match_id?: number }; } catch { /* ok */ }

  const specificMatchId = typeof body.match_id === "number" ? body.match_id : null;

  // Nếu không phải admin và không chỉ định match_id cụ thể → từ chối
  if (!session.is_admin && specificMatchId === null) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  // Kiểm tra backend online trước
  const online = await isBackendOnline();
  if (!online) {
    return NextResponse.json({
      ok: false,
      message: "Backend đang offline. Thử lại sau.",
      backend_online: false,
    }, { status: 503 });
  }

  try {
    // Lấy danh sách pending matches cần chạy
    let pendingMatches: {
      id: number;
      agent1_id: number;
      agent1_code: string;
      agent2_id: number;
      agent2_code: string;
    }[];

    if (specificMatchId !== null) {
      // User kích hoạt trận cụ thể — validate quyền
      const rows = await sql`
        SELECT
          fm.id::int,
          fm.agent1_id::int, a1.code AS agent1_code,
          fm.agent2_id::int, a2.code AS agent2_code,
          fm.challenger_id::int, fm.opponent_id::int
        FROM friendly_matches fm
        JOIN arena_agents a1 ON a1.id = fm.agent1_id
        JOIN arena_agents a2 ON a2.id = fm.agent2_id
        WHERE fm.id = ${specificMatchId}
          AND fm.pending_backend = true
          AND fm.status = 'scheduled'
      ` as {
        id: number; agent1_id: number; agent1_code: string;
        agent2_id: number; agent2_code: string;
        challenger_id: number; opponent_id: number;
      }[];

      if (rows.length === 0) {
        return NextResponse.json({ error: "Trận không tồn tại hoặc không pending." }, { status: 404 });
      }

      const match = rows[0];
      // User phải là challenger hoặc opponent của trận này
      if (!session.is_admin &&
          Number(match.challenger_id) !== Number(session.id) &&
          Number(match.opponent_id) !== Number(session.id)) {
        return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
      }

      pendingMatches = rows.map(r => ({
        id: Number(r.id),
        agent1_id: Number(r.agent1_id),
        agent1_code: r.agent1_code,
        agent2_id: Number(r.agent2_id),
        agent2_code: r.agent2_code,
      }));
    } else {
      // Admin: lấy tất cả pending, giới hạn 20 mỗi lần để tránh timeout
      const rows = await sql`
        SELECT
          fm.id::int,
          fm.agent1_id::int, a1.code AS agent1_code,
          fm.agent2_id::int, a2.code AS agent2_code
        FROM friendly_matches fm
        JOIN arena_agents a1 ON a1.id = fm.agent1_id
        JOIN arena_agents a2 ON a2.id = fm.agent2_id
        WHERE fm.pending_backend = true
          AND fm.status = 'scheduled'
        ORDER BY fm.created_at ASC
        LIMIT 20
      ` as {
        id: number; agent1_id: number; agent1_code: string;
        agent2_id: number; agent2_code: string;
      }[];
      pendingMatches = rows.map(r => ({
        id: Number(r.id),
        agent1_id: Number(r.agent1_id),
        agent1_code: r.agent1_code,
        agent2_id: Number(r.agent2_id),
        agent2_code: r.agent2_code,
      }));
    }

    if (pendingMatches.length === 0) {
      return NextResponse.json({ ok: true, message: "Không có trận nào đang chờ.", processed: 0, errors: 0, results: [] });
    }

    const results: Array<{
      match_id: number;
      success: boolean;
      outcome?: string;
      total_moves?: number;
      error?: string;
    }> = [];

    // Xử lý tuần tự để tránh overload backend
    for (const match of pendingMatches) {
      const result = await runMatch(match);
      results.push(result);
    }

    const processed = results.filter(r => r.success).length;
    const errors = results.filter(r => !r.success).length;

    return NextResponse.json({
      ok: true,
      backend_online: true,
      processed,
      errors,
      results,
    });
  } catch (error) {
    console.error("Process pending failed:", error);
    return NextResponse.json({ error: "Lỗi xử lý trận chờ." }, { status: 500 });
  }
}

// ─── Helper: chạy 1 trận ─────────────────────────────────────────────────────

async function runMatch(match: {
  id: number;
  agent1_id: number; agent1_code: string;
  agent2_id: number; agent2_code: string;
}) {
  // Mark đang chạy
  await sql`
    UPDATE friendly_matches SET status = 'running' WHERE id = ${match.id}
  `;

  try {
    // 1. Tạo match trên backend
    const createResult = await backendFetch("/matches/", {
      method: "POST",
      body: JSON.stringify({
        agent1_code: match.agent1_code,
        agent2_code: match.agent2_code,
        max_moves: 300,
      }),
      timeoutMs: 10_000,
    });

    if (!createResult.ok) {
      await sql`
        UPDATE friendly_matches
        SET status = 'error', is_infra_error = true, pending_backend = false
        WHERE id = ${match.id}
      `;
      return { match_id: match.id, success: false, error: createResult.error };
    }

    const { match_id: backendMatchId } = createResult.data as { match_id: string };

    // 2. Chạy đến hết
    const runResult = await backendFetch(`/matches/${backendMatchId}/run`, {
      method: "POST",
      timeoutMs: 300_000, // 5 phút
    });

    if (!runResult.ok) {
      await sql`
        UPDATE friendly_matches
        SET status = 'error', is_infra_error = true,
            backend_match_id = ${backendMatchId}, pending_backend = false
        WHERE id = ${match.id}
      `;
      return { match_id: match.id, success: false, error: runResult.error };
    }

    const runData = runResult.data as {
      total_moves: number;
      winner: number | null;
      win_reason: string;
      steps: Array<{
        step_number: number; player: number;
        move?: {
          from_col: number; from_row: number;
          to_col: number; to_row: number;
          from_pos: string; to_pos: string;
        };
        captured?: { type: string };
      }>;
    };

    const winner = runData.winner;
    const outcome = winner === 1 ? "agent1" : winner === 2 ? "agent2" : "draw";
    const winnerAgentId = winner === 1 ? match.agent1_id : winner === 2 ? match.agent2_id : null;

    // 3. Update friendly_match
    await sql`
      UPDATE friendly_matches SET
        status = 'finished',
        pending_backend = false,
        backend_match_id = ${backendMatchId},
        outcome = ${outcome},
        winner_agent_id = ${winnerAgentId},
        win_reason = ${runData.win_reason ?? ""},
        total_moves = ${runData.total_moves},
        finished_at = NOW()
      WHERE id = ${match.id}
    `;

    // 4. Insert move history
    for (const step of runData.steps) {
      if (step.move) {
        await sql`
          INSERT INTO friendly_match_history
            (friendly_match_id, move_number, player,
             from_col, from_row, to_col, to_row,
             from_pos, to_pos, captured_type)
          VALUES
            (${match.id}, ${step.step_number}, ${step.player},
             ${step.move.from_col}, ${step.move.from_row},
             ${step.move.to_col}, ${step.move.to_row},
             ${step.move.from_pos}, ${step.move.to_pos},
             ${step.captured?.type ?? null})
          ON CONFLICT (friendly_match_id, move_number) DO NOTHING
        `;
      }
    }

    // 5. Cleanup backend match
    backendFetch(`/matches/${backendMatchId}`, { method: "DELETE", timeoutMs: 5_000 }).catch(() => {});

    return { match_id: match.id, success: true, outcome, total_moves: runData.total_moves };
  } catch (err) {
    await sql`
      UPDATE friendly_matches
      SET status = 'error', is_infra_error = true, pending_backend = false
      WHERE id = ${match.id}
    `;
    return { match_id: match.id, success: false, error: String(err) };
  }
}
