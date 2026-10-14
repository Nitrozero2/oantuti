import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { sql } from "@/lib/db";
import { backendFetch } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  // 1. Worker status từ backend
  const workerResult = await backendFetch("/workers/status", { timeoutMs: 8_000 });
  const workerStatus = workerResult.ok
    ? (workerResult.data as {
        workers: { worker_id: string; judge0_url: string; active_jobs: number; max_concurrent: number; available_slots: number; seconds_ago: number }[];
        total_workers: number;
        total_active_jobs: number;
        total_available_slots: number;
        queue_depth: number;
      })
    : null;

  // 2. Match stats — gộp friendly + TrueSkill queue
  //    friendly:   scheduled | running | finished | error
  //    rating:     scheduled | running | finished | error | cancelled
  //    Hiển thị:   pending(scheduled) | running | finished | error
  const matchStats = { running: 0, finished: 0, error: 0, pending: 0 };
  try {
    const [friendlyStats, ratingStats] = await Promise.all([
      sql`SELECT status, COUNT(*)::int AS cnt FROM friendly_matches GROUP BY status`,
      sql`SELECT status, COUNT(*)::int AS cnt FROM rated_matches GROUP BY status`,
    ]) as [{ status: string; cnt: number }[], { status: string; cnt: number }[]];

    for (const row of [...friendlyStats, ...ratingStats]) {
      if (row.status === "running")   matchStats.running   += row.cnt;
      if (row.status === "finished")  matchStats.finished  += row.cnt;
      if (row.status === "error")     matchStats.error     += row.cnt;
      // scheduled → pending bucket
      if (row.status === "scheduled") matchStats.pending   += row.cnt;
    }
  } catch { /* ignore */ }

  // 3. Recent matches — gộp cả hai bảng, 20 mới nhất
  let recentMatches: unknown[] = [];
  try {
    recentMatches = await sql`
      SELECT
        id,
        source,
        status,
        outcome,
        total_moves,
        is_infra_error,
        created_at,
        finished_at,
        created_by_username,
        agent1_name,
        agent2_name,
        session_name
      FROM (
        -- Friendly matches
        SELECT
          fm.id,
          'friendly'                  AS source,
          fm.status,
          fm.outcome,
          fm.total_moves,
          fm.is_infra_error,
          fm.created_at,
          fm.finished_at,
          u.username                  AS created_by_username,
          a1.agent_name               AS agent1_name,
          a2.agent_name               AS agent2_name,
          NULL::text                  AS session_name
        FROM friendly_matches fm
        LEFT JOIN users u         ON u.id  = fm.created_by
        LEFT JOIN arena_agents a1 ON a1.id = fm.agent1_id
        LEFT JOIN arena_agents a2 ON a2.id = fm.agent2_id

        UNION ALL

        -- Continuous TrueSkill matches (validation rows are excluded)
        SELECT
          rm.id,
          'rating'                    AS source,
          rm.status,
          rm.outcome,
          rm.total_moves,
          rm.is_infra_error,
          rm.scheduled_at              AS created_at,
          rm.finished_at,
          NULL::text                   AS created_by_username,
          a1.agent_name                AS agent1_name,
          a2.agent_name                AS agent2_name,
          NULL::text                   AS session_name
        FROM rated_matches rm
        LEFT JOIN arena_agents a1 ON a1.id = rm.agent1_id
        LEFT JOIN arena_agents a2 ON a2.id = rm.agent2_id
        WHERE rm.kind = 'rating'
      ) combined
      ORDER BY created_at DESC
      LIMIT 20
    `;
  } catch { /* ignore */ }

  return NextResponse.json({
    backend_online: workerResult.ok,
    worker_status: workerStatus,
    recent_matches: recentMatches,
    match_stats: matchStats,
  });
}
