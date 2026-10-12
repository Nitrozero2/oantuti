import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// GET /api/arena/agents/[id] — agent detail with match history
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  const { id } = await params;
  const agentId = parseInt(id, 10);
  if (isNaN(agentId)) return NextResponse.json({ error: "ID không hợp lệ." }, { status: 400 });

  try {
    const agentRows = await sql`
      SELECT a.id, a.agent_name, a.description, a.version, a.status, a.validation_error,
             a.is_active, a.wins, a.losses, a.draws, a.error_matches, a.elo, a.submitted_at,
             u.username
      FROM arena_agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = ${agentId}
    `;
    if (agentRows.length === 0) return NextResponse.json({ error: "Agent không tồn tại." }, { status: 404 });
    const agent = agentRows[0];

    // Match history (last 30)
    const matchRows = await sql`
      SELECT
        m.id, m.status, m.outcome, m.win_reason, m.total_moves,
        m.elo_delta_agent1, m.elo_delta_agent2,
        m.is_infra_error, m.finished_at, m.scheduled_at,
        a1.agent_name AS agent1_name, u1.username AS agent1_username,
        a2.agent_name AS agent2_name, u2.username AS agent2_username,
        w.agent_name AS winner_name,
        s.name AS session_name
      FROM tournament_matches m
      JOIN arena_agents a1 ON a1.id = m.agent1_id
      JOIN users u1 ON u1.id = a1.user_id
      JOIN arena_agents a2 ON a2.id = m.agent2_id
      JOIN users u2 ON u2.id = a2.user_id
      LEFT JOIN arena_agents w ON w.id = m.winner_agent_id
      LEFT JOIN tournament_sessions s ON s.id = m.session_id
      WHERE m.agent1_id = ${agentId} OR m.agent2_id = ${agentId}
      ORDER BY m.scheduled_at DESC
      LIMIT 30
    `;

    // Version history
    const versionRows = await sql`
      SELECT id, version, agent_name, status, elo, wins, losses, draws, submitted_at
      FROM arena_agents
      WHERE user_id = (SELECT user_id FROM arena_agents WHERE id = ${agentId})
      ORDER BY version DESC
      LIMIT 10
    `;

    return NextResponse.json({ agent, matches: matchRows, versions: versionRows });
  } catch (error) {
    console.error("Agent detail failed:", error);
    return NextResponse.json({ error: "Không thể tải thông tin agent." }, { status: 500 });
  }
}

// PATCH /api/arena/agents/[id] — admin: update status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.is_admin) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });

  const { id } = await params;
  const agentId = parseInt(id, 10);
  if (isNaN(agentId)) return NextResponse.json({ error: "ID không hợp lệ." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  const { status, validation_error } = body as Record<string, unknown>;

  const validStatuses = ["pending", "validating", "active", "rejected"];
  if (typeof status !== "string" || !validStatuses.includes(status))
    return NextResponse.json({ error: "Status không hợp lệ." }, { status: 400 });

  const errMsg = typeof validation_error === "string" ? validation_error : null;
  const isActive = status === "active";

  try {
    if (isActive) {
      // Deactivate other agents of same user
      await sql`
        UPDATE arena_agents SET is_active = false
        WHERE user_id = (SELECT user_id FROM arena_agents WHERE id = ${agentId})
          AND id != ${agentId}
      `;
    }
    await sql`
      UPDATE arena_agents
      SET status = ${status}, validation_error = ${errMsg}, is_active = ${isActive}
      WHERE id = ${agentId}
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Agent patch failed:", error);
    return NextResponse.json({ error: "Không thể cập nhật agent." }, { status: 500 });
  }
}
