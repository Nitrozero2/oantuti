import { backendFetch } from "@/lib/backend";
import { sql } from "@/lib/db";
import { selectOpponent, type RatingCandidate } from "@/lib/rating-selection";

type Agent = {
  id: number; user_id: number; code: string;
  trueskill_mu: number; trueskill_sigma: number;
};


type PendingMatch = {
  id: number; kind: "validation" | "rating"; agent1_id: number; agent2_id: number;
  agent1_code: string; agent2_code: string;
};

const CALLBACK_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

async function acquireLease() {
  const rows = await sql`
    UPDATE rating_scheduler_state
    SET lease_until = NOW() + INTERVAL '30 seconds'
    WHERE id = true AND enabled = true AND lease_until < NOW()
    RETURNING id
  `;
  return rows.length > 0;
}

async function releaseLease() {
  await sql`UPDATE rating_scheduler_state SET lease_until = NOW() WHERE id = true`;
}

async function getUndispatchedMatch(): Promise<PendingMatch | null> {
  const rows = await sql`
    SELECT rm.id::int, rm.kind, rm.agent1_id::int, rm.agent2_id::int,
           a1.code AS agent1_code, a2.code AS agent2_code
    FROM rated_matches rm
    JOIN arena_agents a1 ON a1.id = rm.agent1_id
    JOIN arena_agents a2 ON a2.id = rm.agent2_id
    WHERE rm.status = 'scheduled'
      AND (rm.dispatched_at IS NULL OR rm.dispatched_at < NOW() - INTERVAL '10 minutes')
    ORDER BY CASE rm.kind WHEN 'validation' THEN 0 ELSE 1 END, rm.scheduled_at ASC
    LIMIT 1
  ` as PendingMatch[];
  return rows[0] ?? null;
}

async function createRatingMatch(): Promise<PendingMatch | null> {
  const agents = await sql`
    SELECT a.id::int, a.user_id::int, a.code, a.trueskill_mu, a.trueskill_sigma
    FROM arena_agents a
    WHERE a.status = 'active' AND a.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM rated_matches rm
        WHERE rm.kind = 'rating' AND rm.status IN ('scheduled', 'running')
          AND (rm.agent1_id = a.id OR rm.agent2_id = a.id)
      )
    ORDER BY a.trueskill_sigma DESC, a.submitted_at ASC
  ` as Agent[];

  if (agents.length < 2) return null;
  const focal = agents[0];
  // Do not immediately repeat the most recently completed rating pair when any
  // other eligible opponent exists.
  const lastRows = await sql`
    SELECT agent1_id::int, agent2_id::int FROM rated_matches
    WHERE kind = 'rating' AND status = 'finished'
    ORDER BY finished_at DESC, id DESC LIMIT 1
  ` as { agent1_id: number; agent2_id: number }[];
  const last = lastRows[0];
  const opponent = selectOpponent(focal as RatingCandidate, agents as RatingCandidate[], last) as Agent | null;
  if (!opponent) return null;
  const [agent1, agent2] = Math.random() < 0.5 ? [focal, opponent] : [opponent, focal];

  const inserted = await sql`
    INSERT INTO rated_matches (kind, agent1_id, agent2_id)
    VALUES ('rating', ${agent1.id}, ${agent2.id})
    RETURNING id::int
  ` as { id: number }[];
  if (!inserted[0]) return null;
  return {
    id: Number(inserted[0].id), kind: "rating", agent1_id: agent1.id, agent2_id: agent2.id,
    agent1_code: agent1.code, agent2_code: agent2.code,
  };
}

async function enqueue(match: PendingMatch) {
  const response = await backendFetch("/rating/enqueue", {
    method: "POST",
    body: JSON.stringify({
      rated_match_id: match.id,
      kind: match.kind,
      agent1_id: match.agent1_id,
      agent1_code: match.agent1_code,
      agent2_id: match.agent2_id,
      agent2_code: match.agent2_code,
      max_moves: 300,
      callback_url: CALLBACK_URL,
    }),
    timeoutMs: 10_000,
  });
  if (!response.ok) return { queued: false, error: response.error };
  await sql`UPDATE rated_matches SET dispatched_at = NOW() WHERE id = ${match.id} AND status = 'scheduled'`;
  return { queued: true };
}

/** Create or re-enqueue one task. Called by workers when they have capacity. */
export async function dispatchNextRatingTask() {
  if (!(await acquireLease())) return { dispatched: false, reason: "busy" as const };
  try {
    const match = (await getUndispatchedMatch()) ?? (await createRatingMatch());
    if (!match) return { dispatched: false, reason: "no-eligible-pair" as const };
    return { dispatched: true, match_id: match.id, kind: match.kind, ...(await enqueue(match)) };
  } finally {
    await releaseLease();
  }
}
