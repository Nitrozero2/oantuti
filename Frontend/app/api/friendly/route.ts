import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { backendFetch, isBackendOnline } from "@/lib/backend";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

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

// POST: create and enqueue a friendly match → worker chạy local engine
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

    // Kiểm tra backend online
    const online = await isBackendOnline();
    if (!online) {
      return NextResponse.json(
        { error: "Backend (worker) đang offline. Vui lòng thử lại sau.", backend_offline: true },
        { status: 503 }
      );
    }

    // Insert friendly match với status='scheduled'
    const fmRows = await sql`
      INSERT INTO friendly_matches (created_by, agent1_id, agent2_id, status)
      VALUES (${session.id}, ${agent1_id}, ${agent2_id}, 'scheduled')
      RETURNING id
    `;
    const friendlyMatchId = (fmRows[0] as { id: number }).id;

    // Enqueue vào worker queue — worker sẽ tự chạy local engine
    const enqueueResult = await backendFetch("/friendly/enqueue", {
      method: "POST",
      body: JSON.stringify({
        friendly_match_id: friendlyMatchId,
        agent1_id,
        agent1_code: a1.code,
        agent2_id,
        agent2_code: a2.code,
        max_moves: 300,
        callback_url: FRONTEND_URL,
      }),
      timeoutMs: 10_000,
    });

    if (!enqueueResult.ok) {
      // Rollback status
      await sql`UPDATE friendly_matches SET status = 'error', is_infra_error = true WHERE id = ${friendlyMatchId}`;
      return NextResponse.json(
        { error: enqueueResult.error, backend_offline: enqueueResult.isOffline },
        { status: enqueueResult.isOffline ? 503 : 500 }
      );
    }

    // Trả về ngay — không chờ kết quả
    return NextResponse.json({
      ok: true,
      friendly_match_id: friendlyMatchId,
      status: "scheduled",
      message: "Trận đấu đã được xếp hàng. Worker sẽ chạy và cập nhật kết quả tự động.",
    });
  } catch (error) {
    console.error("Friendly enqueue failed:", error);
    return NextResponse.json({ error: "Lỗi khi tạo trận." }, { status: 500 });
  }
}
