import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// GET: list all sessions (public — any logged-in user can view)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  try {
    const rows = await sql`
      SELECT
        s.id, s.name, s.status, s.config, s.notes,
        s.created_at, s.started_at, s.paused_at, s.stopped_at, s.completed_at,
        u.username AS created_by_username,
        COUNT(m.id)::int AS total_matches,
        COUNT(m.id) FILTER (WHERE m.status = 'scheduled')::int AS scheduled_matches,
        COUNT(m.id) FILTER (WHERE m.status = 'running')::int AS running_matches,
        COUNT(m.id) FILTER (WHERE m.status = 'finished')::int AS finished_matches,
        COUNT(m.id) FILTER (WHERE m.status = 'error')::int AS error_matches
      FROM tournament_sessions s
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN tournament_matches m ON m.session_id = s.id
      GROUP BY s.id, u.username
      ORDER BY s.created_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ sessions: rows });
  } catch (error) {
    console.error("Sessions list failed:", error);
    return NextResponse.json({ error: "Không thể tải danh sách session." }, { status: 500 });
  }
}

// POST: create new session + generate all match pairs (admin)
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.is_admin) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  const { name, config, notes } = body as Record<string, unknown>;

  const sessionName = typeof name === "string" ? name.trim().slice(0, 100) : `Session ${new Date().toLocaleDateString("vi-VN")}`;
  const sessionNotes = typeof notes === "string" ? notes.trim().slice(0, 1000) : "";
  const cfg = typeof config === "object" && config !== null ? config as Record<string, unknown> : {};
  const sessionConfig = {
    max_parallel_matches: typeof cfg.max_parallel_matches === "number" ? Math.min(10, Math.max(1, cfg.max_parallel_matches)) : 3,
    new_agent_policy: cfg.new_agent_policy === "include" ? "include" : "exclude",
    allow_rematch: cfg.allow_rematch === true,
    max_moves: typeof cfg.max_moves === "number" ? Math.min(1000, Math.max(50, cfg.max_moves)) : 300,
  };

  try {
    // Lấy tất cả active agents
    const agents = await sql`
      SELECT a.id AS agent_id, a.user_id
      FROM arena_agents a
      WHERE a.status = 'active'
      ORDER BY a.user_id, a.id
    ` as { agent_id: number; user_id: number }[];

    if (agents.length < 2) {
      return NextResponse.json({ error: "Cần ít nhất 2 agent active từ 2 người dùng khác nhau." }, { status: 400 });
    }

    // Tạo session
    const sessionRows = await sql`
      INSERT INTO tournament_sessions (name, status, created_by, config, notes)
      VALUES (${sessionName}, 'idle', ${session.id}, ${JSON.stringify(sessionConfig)}, ${sessionNotes})
      RETURNING id
    `;
    const sessionId = (sessionRows[0] as { id: number }).id;

    // Tạo tất cả cặp đấu cross-user (không ghép cùng user)
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        if (agents[i].user_id !== agents[j].user_id) {
          pairs.push([agents[i].agent_id, agents[j].agent_id]);
        }
      }
    }

    if (pairs.length === 0) {
      // Rollback session
      await sql`DELETE FROM tournament_sessions WHERE id = ${sessionId}`;
      return NextResponse.json({ error: "Không có cặp đấu hợp lệ (tất cả agent cùng 1 user)." }, { status: 400 });
    }

    // Bulk insert match pairs
    for (const [a1, a2] of pairs) {
      await sql`
        INSERT INTO tournament_matches (session_id, agent1_id, agent2_id, status)
        VALUES (${sessionId}, ${a1}, ${a2}, 'scheduled')
        ON CONFLICT (session_id, agent1_id, agent2_id) DO NOTHING
      `;
    }

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      total_agents: agents.length,
      total_pairs: pairs.length,
    });
  } catch (error) {
    console.error("Create session failed:", error);
    return NextResponse.json({ error: "Không thể tạo session." }, { status: 500 });
  }
}
