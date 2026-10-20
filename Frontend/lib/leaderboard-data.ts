import { sql } from '@/lib/db';
import type { RankedAgent } from '@/lib/leaderboard';
// Explicit projection: never expose submission source or private account data.
export async function publicAgents(userId: number | null = null) {
  return await sql`
    SELECT a.id, a.user_id, u.username, a.agent_name, a.version, a.status,
      a.is_active, a.rating AS elo, a.wins, a.losses, a.draws, a.submitted_at,
      COALESCE(s.valid_games, 0)::int AS valid_games, s.last_finished_at,
      a.team_id,t.name AS team_name,t.recruiting,agent_scope_active(a.id) AS scope_active,
      COALESCE((SELECT json_agg(m ORDER BY m.id) FROM (SELECT u2.id,u2.username FROM team_members tm JOIN users u2 ON u2.id=tm.user_id WHERE tm.team_id=a.team_id) m),'[]'::json) AS members
    FROM arena_agents a JOIN users u ON u.id = a.user_id
    LEFT JOIN teams t ON t.id=a.team_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS valid_games, MAX(m.finished_at) AS last_finished_at
      FROM rated_matches m WHERE m.kind = 'rating' AND m.status = 'finished'
        AND NOT m.is_infra_error AND (m.agent1_id = a.id OR m.agent2_id = a.id)
    ) s ON true
    WHERE a.status = 'active' AND a.is_public AND (${userId}::bigint IS NULL OR a.user_id = ${userId})
  ` as RankedAgent[];
}
