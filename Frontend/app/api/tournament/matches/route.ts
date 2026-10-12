import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionIdRaw = searchParams.get("session_id");
  const agentIdRaw   = searchParams.get("agent_id");
  const statusRaw    = searchParams.get("status");
  const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const sessionId = sessionIdRaw ? parseInt(sessionIdRaw, 10) : null;
  const agentId   = agentIdRaw   ? parseInt(agentIdRaw,   10) : null;
  const status    = statusRaw    ?? null;

  try {
    // Neon tagged-template only — branch on filter combinations to avoid null param type errors
    const SELECT = `
      SELECT
        m.id, m.session_id, m.status, m.outcome, m.win_reason,
        m.total_moves, m.is_infra_error,
        m.elo_delta_agent1, m.elo_delta_agent2,
        m.scheduled_at, m.started_at, m.finished_at,
        a1.id AS agent1_id, a1.agent_name AS agent1_name, u1.username AS agent1_username,
        a2.id AS agent2_id, a2.agent_name AS agent2_name, u2.username AS agent2_username,
        w.agent_name AS winner_name,
        s.name AS session_name
      FROM tournament_matches m
      JOIN arena_agents a1 ON a1.id = m.agent1_id
      JOIN users u1 ON u1.id = a1.user_id
      JOIN arena_agents a2 ON a2.id = m.agent2_id
      JOIN users u2 ON u2.id = a2.user_id
      LEFT JOIN arena_agents w ON w.id = m.winner_agent_id
      LEFT JOIN tournament_sessions s ON s.id = m.session_id
    `;

    let rows: unknown[];

    // Branch by which filters are present — never pass null as a typed param
    if (sessionId !== null && agentId !== null && status !== null) {
      rows = await sql`${sql.unsafe(SELECT)}
        WHERE m.session_id = ${sessionId} AND (m.agent1_id = ${agentId} OR m.agent2_id = ${agentId}) AND m.status = ${status}
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (sessionId !== null && agentId !== null) {
      rows = await sql`${sql.unsafe(SELECT)}
        WHERE m.session_id = ${sessionId} AND (m.agent1_id = ${agentId} OR m.agent2_id = ${agentId})
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (sessionId !== null && status !== null) {
      rows = await sql`${sql.unsafe(SELECT)}
        WHERE m.session_id = ${sessionId} AND m.status = ${status}
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (agentId !== null && status !== null) {
      rows = await sql`${sql.unsafe(SELECT)}
        WHERE (m.agent1_id = ${agentId} OR m.agent2_id = ${agentId}) AND m.status = ${status}
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (sessionId !== null) {
      rows = await sql`${sql.unsafe(SELECT)}
        WHERE m.session_id = ${sessionId}
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (agentId !== null) {
      rows = await sql`${sql.unsafe(SELECT)}
        WHERE (m.agent1_id = ${agentId} OR m.agent2_id = ${agentId})
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (status !== null) {
      rows = await sql`${sql.unsafe(SELECT)}
        WHERE m.status = ${status}
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else {
      rows = await sql`${sql.unsafe(SELECT)}
        ORDER BY m.scheduled_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }

    return NextResponse.json({ matches: rows, page, limit });
  } catch (error) {
    console.error("Matches list failed:", error);
    return NextResponse.json({ error: "Không thể tải danh sách trận." }, { status: 500 });
  }
}
