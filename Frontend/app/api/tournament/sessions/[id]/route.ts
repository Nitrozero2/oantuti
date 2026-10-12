import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// GET: session detail + match stats breakdown
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }

  try {
    const sessionRows = await sql`
      SELECT
        ts.id AS session_id,
        ts.name,
        ts.status,
        ts.config,
        ts.created_at,
        ts.started_at,
        ts.paused_at,
        ts.stopped_at,
        ts.completed_at,
        ts.notes,
        u.username AS created_by_username
      FROM tournament_sessions ts
      JOIN users u ON u.id = ts.created_by
      WHERE ts.id = ${sessionId}
    `;

    if (sessionRows.length === 0) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const sessionData = sessionRows[0];

    // Match stats breakdown
    const statsRows = await sql`
      SELECT
        COUNT(*)::int AS total_matches,
        COUNT(*) FILTER (WHERE status = 'finished')::int AS finished_matches,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running_matches,
        COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled_matches,
        COUNT(*) FILTER (WHERE status = 'error')::int AS error_matches,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_matches,
        COUNT(*) FILTER (WHERE outcome = 'agent1')::int AS agent1_wins,
        COUNT(*) FILTER (WHERE outcome = 'agent2')::int AS agent2_wins,
        COUNT(*) FILTER (WHERE outcome = 'draw')::int AS draws,
        COUNT(*) FILTER (WHERE is_infra_error = true)::int AS infra_errors
      FROM tournament_matches
      WHERE session_id = ${sessionId}
    `;

    return NextResponse.json({
      session: sessionData,
      stats: statsRows[0] ?? {},
    });
  } catch (error) {
    console.error("Session detail failed:", error);
    return NextResponse.json({ error: "Failed to load session." }, { status: 500 });
  }
}
