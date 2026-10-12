import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { backendFetch, backendOfflineResponse } from "@/lib/backend";

export const runtime = "nodejs";

// GET: list friendly matches (public + own)
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const offset = (page - 1) * 20;

  try {
    const rows = await sql`
      SELECT
        fm.id, fm.status, fm.outcome, fm.win_reason, fm.total_moves,
        fm.is_infra_error, fm.created_at, fm.finished_at,
        a1.id AS agent1_id, a1.agent_name AS agent1_name, u1.username AS agent1_username,
        a2.id AS agent2_id, a2.agent_name AS agent2_name, u2.username AS agent2_username,
        w.agent_name AS winner_name,
        uc.username AS created_by_username
      FROM friendly_matches fm
      JOIN arena_agents a1 ON a1.id = fm.agent1_id
      JOIN users u1 ON u1.id = a1.user_id
      JOIN arena_agents a2 ON a2.id = fm.agent2_id
      JOIN users u2 ON u2.id = a2.user_id
      LEFT JOIN arena_agents w ON w.id = fm.winner_agent_id
      LEFT JOIN users uc ON uc.id = fm.created_by
      WHERE fm.is_public = true OR fm.created_by = ${session.id}
      ORDER BY fm.created_at DESC
      LIMIT 20 OFFSET ${offset}
    `;
    return NextResponse.json({ matches: rows, page });
  } catch (error) {
    console.error("Friendly list failed:", error);
    return NextResponse.json({ error: "Không thể tải danh sách trận." }, { status: 500 });
  }
}

// POST: create and run a friendly match
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  const { agent1_id, agent2_id } = body as Record<string, unknown>;
  if (typeof agent1_id !== "number" || typeof agent2_id !== "number")
    return NextResponse.json({ error: "Cần agent1_id và agent2_id." }, { status: 400 });
  if (agent1_id === agent2_id)
    return NextResponse.json({ error: "Hai agent phải khác nhau." }, { status: 400 });

  try {
    // Validate agents belong to different users
    const agentRows = await sql`
      SELECT id, user_id, code, status FROM arena_agents WHERE id IN (${agent1_id}, ${agent2_id})
    ` as { id: number; user_id: number; code: string; status: string }[];

    if (agentRows.length !== 2)
      return NextResponse.json({ error: "Không tìm thấy agent." }, { status: 404 });

    const a1 = agentRows.find(a => Number(a.id) === Number(agent1_id))!;
    const a2 = agentRows.find(a => Number(a.id) === Number(agent2_id))!;

    if (Number(a1.user_id) === Number(a2.user_id))
      return NextResponse.json({ error: "Hai agent phải thuộc hai người dùng khác nhau." }, { status: 400 });

    if (a1.status !== "active" || a2.status !== "active")
      return NextResponse.json({ error: "Cả hai agent phải có status 'active'." }, { status: 400 });

    // Insert friendly match record
    const fmRows = await sql`
      INSERT INTO friendly_matches (created_by, agent1_id, agent2_id, status)
      VALUES (${session.id}, ${agent1_id}, ${agent2_id}, 'running')
      RETURNING id
    `;
    const friendlyMatchId = (fmRows[0] as { id: number }).id;

    // Run match on FastAPI backend (với timeout 8s cho create)
    const createResult = await backendFetch("/matches/", {
      method: "POST",
      body: JSON.stringify({ agent1_code: a1.code, agent2_code: a2.code, max_moves: 300 }),
      timeoutMs: 8_000,
    });

    if (!createResult.ok) {
      await sql`UPDATE friendly_matches SET status = 'error', is_infra_error = true WHERE id = ${friendlyMatchId}`;
      return NextResponse.json(
        { error: createResult.error, backend_offline: createResult.isOffline },
        { status: createResult.isOffline ? 503 : 500 },
      );
    }

    const matchData = createResult.data as { match_id: string };
    const backendMatchId = matchData.match_id;

    // Run to end (timeout dài hơn — tối đa 300 nước × ~1.5s = ~5 phút)
    const runResult = await backendFetch(`/matches/${backendMatchId}/run`, {
      method: "POST",
      timeoutMs: 300_000, // 5 phút
    });

    if (!runResult.ok) {
      await sql`UPDATE friendly_matches SET status = 'error', is_infra_error = true, backend_match_id = ${backendMatchId} WHERE id = ${friendlyMatchId}`;
      return NextResponse.json(
        { error: runResult.error, backend_offline: runResult.isOffline },
        { status: runResult.isOffline ? 503 : 500 },
      );
    }

    const runData = runResult.data as {
      total_moves: number; game_over: boolean; winner: number | null; win_reason: string;
      steps: Array<{
        step_number: number; player: number;
        move?: { from_col: number; from_row: number; to_col: number; to_row: number; from_pos: string; to_pos: string };
        captured?: { type: string }; game_over: boolean; error?: string;
      }>;
    };

    const winner = runData.winner;
    const outcome = winner === 1 ? "agent1" : winner === 2 ? "agent2" : "draw";
    const winnerAgentId = winner === 1 ? agent1_id : winner === 2 ? agent2_id : null;

    // Update friendly match
    await sql`
      UPDATE friendly_matches SET
        status = 'finished', backend_match_id = ${backendMatchId},
        outcome = ${outcome}, winner_agent_id = ${winnerAgentId},
        win_reason = ${runData.win_reason ?? ""}, total_moves = ${runData.total_moves},
        finished_at = NOW()
      WHERE id = ${friendlyMatchId}
    `;

    // Insert move history
    for (const step of runData.steps) {
      if (step.move) {
        await sql`
          INSERT INTO friendly_match_history
            (friendly_match_id, move_number, player, from_col, from_row, to_col, to_row, from_pos, to_pos, captured_type)
          VALUES
            (${friendlyMatchId}, ${step.step_number}, ${step.player},
             ${step.move.from_col}, ${step.move.from_row}, ${step.move.to_col}, ${step.move.to_row},
             ${step.move.from_pos}, ${step.move.to_pos}, ${step.captured?.type ?? null})
          ON CONFLICT (friendly_match_id, move_number) DO NOTHING
        `;
      }
    }

    // Cleanup backend match (fire-and-forget, bỏ qua lỗi)
    backendFetch(`/matches/${backendMatchId}`, { method: "DELETE", timeoutMs: 5_000 }).catch(() => {});

    return NextResponse.json({ ok: true, friendly_match_id: friendlyMatchId, outcome, total_moves: runData.total_moves });
  } catch (error) {
    console.error("Friendly match failed:", error);
    return NextResponse.json({ error: "Lỗi khi chạy trận." }, { status: 500 });
  }
}
