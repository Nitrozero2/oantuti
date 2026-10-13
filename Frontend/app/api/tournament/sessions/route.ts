import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// GET: list all sessions (admin)
export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });

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

// POST: create new session only (no matches yet — admin must confirm pairs separately)
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
    // Kiểm tra có đủ agents không
    const agents = await sql`
      SELECT a.id AS agent_id, a.user_id
      FROM arena_agents a
      WHERE a.status = 'active'
      ORDER BY a.user_id, a.id
    ` as { agent_id: number; user_id: number }[];

    const crossUserPairs = agents.filter((a, i) =>
      agents.some((b, j) => j > i && b.user_id !== a.user_id)
    );
    if (agents.length < 2 || crossUserPairs.length === 0) {
      return NextResponse.json({ error: "Cần ít nhất 2 agent active từ 2 người dùng khác nhau." }, { status: 400 });
    }

    // Tạo session với trạng thái 'idle' — CHƯA insert matches, chờ confirm-pairs
    const sessionRows = await sql`
      INSERT INTO tournament_sessions (name, status, created_by, config, notes)
      VALUES (${sessionName}, 'idle', ${session.id}, ${JSON.stringify(sessionConfig)}, ${sessionNotes})
      RETURNING id
    `;
    const sessionId = (sessionRows[0] as { id: number }).id;

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      // Báo cho frontend biết cần vào bước xác nhận cặp đấu
      needs_pair_confirmation: true,
      total_agents: agents.length,
    });
  } catch (error) {
    console.error("Create session failed:", error);
    return NextResponse.json({ error: "Không thể tạo session." }, { status: 500 });
  }
}
