import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// Legacy arena matches are retained for replay only. TrueSkill rating updates
// are exclusively performed by /api/rating/match-result.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const { backend_match_id, agent1_id, agent2_id, winner_agent_id, win_reason, total_moves } =
    body as {
      backend_match_id?: unknown;
      agent1_id?: unknown;
      agent2_id?: unknown;
      winner_agent_id?: unknown;
      win_reason?: unknown;
      total_moves?: unknown;
    };

  if (
    typeof backend_match_id !== "string" ||
    typeof agent1_id !== "number" ||
    typeof agent2_id !== "number"
  ) {
    return NextResponse.json({ error: "Thiếu thông tin trận đấu." }, { status: 400 });
  }

  try {
    const agentRows = await sql`
      SELECT id
      FROM arena_agents
      WHERE id IN (${agent1_id}, ${agent2_id})
    `;

    if (agentRows.length !== 2) {
      return NextResponse.json({ error: "Không tìm thấy agent." }, { status: 404 });
    }

    const winnerId =
      typeof winner_agent_id === "number" ? winner_agent_id : null;
    const winReason =
      typeof win_reason === "string" ? win_reason.slice(0, 500) : "";
    const moves = typeof total_moves === "number" ? total_moves : 0;

    // Ghi trận đấu
    await sql`
      INSERT INTO arena_matches
        (backend_match_id, agent1_id, agent2_id, winner_agent_id, win_reason, total_moves, status, finished_at)
      VALUES
        (${backend_match_id}, ${agent1_id}, ${agent2_id}, ${winnerId}, ${winReason}, ${moves}, 'finished', NOW())
    `;

    return NextResponse.json({ ok: true, rated: false });
  } catch (error) {
    console.error("Arena record match failed:", error);
    return NextResponse.json({ error: "Không thể lưu kết quả trận." }, { status: 500 });
  }
}

// GET: lịch sử trận đấu arena
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }

  try {
    const rows = await sql`
      SELECT
        m.id,
        m.backend_match_id,
        m.status,
        m.total_moves,
        m.win_reason,
        m.played_at,
        a1.agent_name AS agent1_name,
        u1.username AS agent1_username,
        a2.agent_name AS agent2_name,
        u2.username AS agent2_username,
        w.agent_name AS winner_name
      FROM arena_matches m
      JOIN arena_agents a1 ON a1.id = m.agent1_id
      JOIN users u1 ON u1.id = a1.user_id
      JOIN arena_agents a2 ON a2.id = m.agent2_id
      JOIN users u2 ON u2.id = a2.user_id
      LEFT JOIN arena_agents w ON w.id = m.winner_agent_id
      ORDER BY m.played_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ matches: rows });
  } catch (error) {
    console.error("Arena matches failed:", error);
    return NextResponse.json({ error: "Không thể tải lịch sử trận đấu." }, { status: 500 });
  }
}
