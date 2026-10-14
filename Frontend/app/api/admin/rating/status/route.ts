import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  try {
    const [summary, agents, matches, scheduler] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE kind = 'rating' AND status = 'scheduled')::int AS rating_scheduled,
          COUNT(*) FILTER (WHERE kind = 'rating' AND status = 'running')::int AS rating_running,
          COUNT(*) FILTER (WHERE kind = 'validation' AND status IN ('scheduled', 'running'))::int AS validating,
          COUNT(*) FILTER (WHERE kind = 'rating' AND status = 'finished')::int AS rating_finished
        FROM rated_matches
      `,
      sql`
        SELECT a.id::int, a.agent_name, u.username, a.rating, a.trueskill_mu, a.trueskill_sigma,
          a.wins, a.losses, a.draws
        FROM arena_agents a
        JOIN users u ON u.id = a.user_id
        WHERE a.status = 'active' AND a.is_active = true
        ORDER BY a.trueskill_sigma DESC, a.submitted_at ASC
        LIMIT 30
      `,
      sql`
        SELECT m.id::int, m.status, m.outcome, m.is_infra_error, m.finished_at,
          a1.agent_name AS agent1_name, a2.agent_name AS agent2_name,
          m.agent1_mu_before, m.agent1_sigma_before, m.agent1_mu_after, m.agent1_sigma_after,
          m.agent2_mu_before, m.agent2_sigma_before, m.agent2_mu_after, m.agent2_sigma_after,
          m.rating_delta_agent1, m.rating_delta_agent2
        FROM rated_matches m
        JOIN arena_agents a1 ON a1.id = m.agent1_id
        JOIN arena_agents a2 ON a2.id = m.agent2_id
        WHERE m.kind = 'rating'
        ORDER BY m.scheduled_at DESC
        LIMIT 20
      `,
      sql`SELECT enabled FROM rating_scheduler_state WHERE id = true`,
    ]);
    return NextResponse.json({ summary: summary[0] ?? {}, agents, matches, scheduler_enabled: scheduler[0]?.enabled === true });
  } catch (error) {
    console.error("Rating admin status failed:", error);
    return NextResponse.json({ error: "Không thể tải trạng thái rating." }, { status: 500 });
  }
}
