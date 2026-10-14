import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

const K = 32;
function calcElo(rA: number, rB: number, outcome: "win" | "loss" | "draw") {
  const exp = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  const score = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
  const delta = Math.round(K * (score - exp));
  return { newA: rA + delta, newB: rB - delta, deltaA: delta };
}

type MoveEntry = {
  move_number: number; player: number;
  from_col: number; from_row: number; to_col: number; to_row: number;
  from_pos: string; to_pos: string;
  piece_type: string | null; captured_type: string | null;
};

export async function POST(request: Request) {
  // Called by FastAPI worker — no auth needed, trust internal calls
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const {
    match_id, session_id, backend_match_id,
    agent1_id, agent2_id,
    outcome, winner_agent_id, win_reason, total_moves,
    is_infra_error, infra_error_detail, moves_history,
    event,
  } = body as Record<string, unknown>;

  if (typeof match_id !== "number" || typeof session_id !== "number")
    return NextResponse.json({ error: "match_id and session_id required." }, { status: 400 });

  // Event = "started": worker vừa bắt đầu chạy trận → set running
  if (event === "started") {
    try {
      await sql`
        UPDATE tournament_matches
        SET status = 'running', backend_match_id = ${typeof backend_match_id === "string" ? backend_match_id : null}
        WHERE id = ${match_id} AND status = 'scheduled'
      `;
      return NextResponse.json({ ok: true, event: "started" });
    } catch (err) {
      console.error("match-result started failed:", err);
      return NextResponse.json({ error: "DB error." }, { status: 500 });
    }
  }

  const isInfra = is_infra_error === true;
  const outcomeStr = typeof outcome === "string" ? outcome : null;
  const winnerAgentId = typeof winner_agent_id === "number" ? winner_agent_id : null;
  const winReason = typeof win_reason === "string" ? win_reason.slice(0, 500) : "";
  const moves = typeof total_moves === "number" ? total_moves : 0;
  const backendId = typeof backend_match_id === "string" ? backend_match_id : null;
  const infraDetail = typeof infra_error_detail === "string" ? infra_error_detail.slice(0, 1000) : null;
  const history = Array.isArray(moves_history) ? moves_history as MoveEntry[] : [];

  try {
    // 1. Update tournament_match
    const matchStatus = isInfra ? "error" : "finished";
    await sql`
      UPDATE tournament_matches SET
        status = ${matchStatus},
        backend_match_id = ${backendId},
        outcome = ${outcomeStr},
        winner_agent_id = ${winnerAgentId},
        win_reason = ${winReason},
        total_moves = ${moves},
        is_infra_error = ${isInfra},
        infra_error_detail = ${infraDetail},
        finished_at = NOW()
      WHERE id = ${match_id}
    `;

    // 2. Insert move history
    if (history.length > 0) {
      for (const mv of history) {
        await sql`
          INSERT INTO match_move_history
            (match_id, move_number, player, from_col, from_row, to_col, to_row, from_pos, to_pos, piece_type, captured_type)
          VALUES
            (${match_id}, ${mv.move_number}, ${mv.player},
             ${mv.from_col}, ${mv.from_row}, ${mv.to_col}, ${mv.to_row},
             ${mv.from_pos}, ${mv.to_pos}, ${mv.piece_type ?? null}, ${mv.captured_type ?? null})
          ON CONFLICT (match_id, move_number) DO NOTHING
        `;
      }
    }

    // 3. ELO update (only for valid, non-infra-error matches)
    if (!isInfra && outcomeStr && typeof agent1_id === "number" && typeof agent2_id === "number") {
      const agentRows = await sql`
        SELECT id::int, elo, wins, losses, draws FROM arena_agents WHERE id IN (${agent1_id}, ${agent2_id})
      ` as { id: number; elo: number; wins: number; losses: number; draws: number }[];

      const a1 = agentRows.find(r => Number(r.id) === Number(agent1_id));
      const a2 = agentRows.find(r => Number(r.id) === Number(agent2_id));

      if (a1 && a2) {
        const eloOutcome: "win" | "loss" | "draw" =
          outcomeStr === "agent1" ? "win" : outcomeStr === "agent2" ? "loss" : "draw";
        const { newA, newB, deltaA } = calcElo(a1.elo, a2.elo, eloOutcome);
        const deltaB = newB - a2.elo;

        // Update agent1 stats
        await sql`
          UPDATE arena_agents SET
            elo = ${newA},
            wins   = wins   + ${outcomeStr === "agent1" ? 1 : 0},
            losses = losses + ${outcomeStr === "agent2" ? 1 : 0},
            draws  = draws  + ${outcomeStr === "draw"   ? 1 : 0}
          WHERE id = ${agent1_id}
        `;
        // Update agent2 stats
        await sql`
          UPDATE arena_agents SET
            elo = ${newB},
            wins   = wins   + ${outcomeStr === "agent2" ? 1 : 0},
            losses = losses + ${outcomeStr === "agent1" ? 1 : 0},
            draws  = draws  + ${outcomeStr === "draw"   ? 1 : 0}
          WHERE id = ${agent2_id}
        `;
        // Store ELO deltas on match
        await sql`
          UPDATE tournament_matches SET elo_delta_agent1 = ${deltaA}, elo_delta_agent2 = ${deltaB}
          WHERE id = ${match_id}
        `;
      }
    } else if (isInfra && typeof agent1_id === "number" && typeof agent2_id === "number") {
      // Increment error_matches (don't touch ELO)
      await sql`UPDATE arena_agents SET error_matches = error_matches + 1 WHERE id IN (${agent1_id}, ${agent2_id})`;
    }

    // 4. Check if session is fully completed
    const pendingRows = await sql`
      SELECT COUNT(*)::int AS pending
      FROM tournament_matches
      WHERE session_id = ${session_id} AND status IN ('scheduled', 'running')
    `;
    const pending = (pendingRows[0] as { pending: number }).pending;
    if (pending === 0) {
      await sql`UPDATE tournament_sessions SET status = 'completed', completed_at = NOW() WHERE id = ${session_id} AND status = 'running'`;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Match result callback failed:", error);
    return NextResponse.json({ error: "DB error." }, { status: 500 });
  }
}
