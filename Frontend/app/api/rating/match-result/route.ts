import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { dispatchNextRatingTask } from "@/lib/rating-scheduler";
import { conservativeRating, rate1v1, type TrueSkillOutcome, type TrueSkillRating } from "@/lib/trueskill";

export const runtime = "nodejs";

type MoveEntry = {
  move_number: number; player: number; from_col: number; from_row: number;
  to_col: number; to_row: number; from_pos: string; to_pos: string;
  piece_type: string | null; captured_type: string | null;
};

type RatedMatch = {
  id: number; kind: "validation" | "rating"; agent1_id: number; agent2_id: number;
  status: string; validation_attempts: number;
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const ratedMatchId = body.rated_match_id;
  if (typeof ratedMatchId !== "number") return NextResponse.json({ error: "rated_match_id required." }, { status: 400 });
  const event = body.event;
  if (event === "started") {
    await sql`UPDATE rated_matches SET status = 'running', started_at = NOW() WHERE id = ${ratedMatchId} AND status = 'scheduled'`;
    return NextResponse.json({ ok: true });
  }

  const isInfra = body.is_infra_error === true;
  const outcome = ["agent1", "agent2", "draw"].includes(String(body.outcome))
    ? body.outcome as TrueSkillOutcome : null;
  const winReason = typeof body.win_reason === "string" ? body.win_reason.slice(0, 500) : "";
  const infraDetail = typeof body.infra_error_detail === "string" ? body.infra_error_detail.slice(0, 1000) : null;
  const totalMoves = typeof body.total_moves === "number" ? body.total_moves : 0;
  const agentError = body.agent_error === true;
  const moves = Array.isArray(body.moves_history) ? body.moves_history as MoveEntry[] : [];

  try {
    const rows = await sql`
      SELECT id::int, kind, agent1_id::int, agent2_id::int, status, validation_attempts
      FROM rated_matches WHERE id = ${ratedMatchId}
    ` as RatedMatch[];
    const match = rows[0];
    if (!match) return NextResponse.json({ error: "Match not found." }, { status: 404 });
    if (match.status === "finished" || match.status === "error") return NextResponse.json({ ok: true, duplicate: true });

    if (isInfra && match.kind === "validation") {
      const attempts = Number(match.validation_attempts) + 1;
      if (attempts < 3) {
        await sql`
          UPDATE rated_matches SET status = 'scheduled', dispatched_at = NULL,
            validation_attempts = ${attempts}, is_infra_error = true,
            infra_error_detail = ${infraDetail}, win_reason = ${winReason}
          WHERE id = ${ratedMatchId}
        `;
      } else {
        await sql`
          UPDATE rated_matches SET status = 'error', finished_at = NOW(), validation_attempts = ${attempts},
            is_infra_error = true, infra_error_detail = ${infraDetail}, win_reason = ${winReason}
          WHERE id = ${ratedMatchId}
        `;
        await sql`
          UPDATE arena_agents SET status = 'rejected', is_active = false,
            validation_error = 'Không thể tự kiểm tra agent sau 3 lần do lỗi hạ tầng.'
          WHERE id = ${match.agent1_id}
        `;
      }
      void dispatchNextRatingTask();
      return NextResponse.json({ ok: true, retrying: attempts < 3 });
    }

    const finalStatus = isInfra ? "error" : "finished";
    const finalized = await sql`
      UPDATE rated_matches SET status = ${finalStatus}, outcome = ${outcome},
        winner_agent_id = ${outcome === "agent1" ? match.agent1_id : outcome === "agent2" ? match.agent2_id : null},
        is_infra_error = ${isInfra}, infra_error_detail = ${infraDetail}, win_reason = ${winReason},
        total_moves = ${totalMoves}, finished_at = NOW()
      WHERE id = ${ratedMatchId} AND status IN ('scheduled', 'running')
      RETURNING id
    `;
    if (finalized.length === 0) return NextResponse.json({ ok: true, duplicate: true });

    for (const move of moves) {
      await sql`
        INSERT INTO rated_match_move_history
          (rated_match_id, move_number, player, from_col, from_row, to_col, to_row, from_pos, to_pos, piece_type, captured_type)
        VALUES (${ratedMatchId}, ${move.move_number}, ${move.player}, ${move.from_col}, ${move.from_row},
          ${move.to_col}, ${move.to_row}, ${move.from_pos}, ${move.to_pos}, ${move.piece_type ?? null}, ${move.captured_type ?? null})
        ON CONFLICT (rated_match_id, move_number) DO NOTHING
      `;
    }

    if (match.kind === "validation") {
      if (!isInfra && !agentError) {
        await sql`
          UPDATE arena_agents SET status = 'active', is_active = true, validation_error = NULL
          WHERE id = ${match.agent1_id} AND status = 'validating'
        `;
      } else if (!isInfra) {
        await sql`
          UPDATE arena_agents SET status = 'rejected', is_active = false, validation_error = ${winReason || "Agent gặp lỗi khi tự đấu."}
          WHERE id = ${match.agent1_id}
        `;
      }
    } else if (!isInfra && outcome) {
      const agents = await sql`
        SELECT id::int, trueskill_mu, trueskill_sigma, rating FROM arena_agents
        WHERE id IN (${match.agent1_id}, ${match.agent2_id})
      ` as Array<{ id: number; trueskill_mu: number; trueskill_sigma: number; rating: number }>;
      const a1 = agents.find((agent) => Number(agent.id) === Number(match.agent1_id));
      const a2 = agents.find((agent) => Number(agent.id) === Number(match.agent2_id));
      if (a1 && a2) {
        const before1: TrueSkillRating = { mu: Number(a1.trueskill_mu), sigma: Number(a1.trueskill_sigma) };
        const before2: TrueSkillRating = { mu: Number(a2.trueskill_mu), sigma: Number(a2.trueskill_sigma) };
        const after = rate1v1(before1, before2, outcome);
        const rating1 = conservativeRating(after.agent1);
        const rating2 = conservativeRating(after.agent2);
        await sql`
          UPDATE arena_agents SET trueskill_mu = ${after.agent1.mu}, trueskill_sigma = ${after.agent1.sigma},
            rating = ${rating1}, wins = wins + ${outcome === 'agent1' ? 1 : 0},
            losses = losses + ${outcome === 'agent2' ? 1 : 0}, draws = draws + ${outcome === 'draw' ? 1 : 0}
          WHERE id = ${match.agent1_id}
        `;
        await sql`
          UPDATE arena_agents SET trueskill_mu = ${after.agent2.mu}, trueskill_sigma = ${after.agent2.sigma},
            rating = ${rating2}, wins = wins + ${outcome === 'agent2' ? 1 : 0},
            losses = losses + ${outcome === 'agent1' ? 1 : 0}, draws = draws + ${outcome === 'draw' ? 1 : 0}
          WHERE id = ${match.agent2_id}
        `;
        await sql`
          UPDATE rated_matches SET
            agent1_mu_before = ${before1.mu}, agent1_sigma_before = ${before1.sigma},
            agent1_mu_after = ${after.agent1.mu}, agent1_sigma_after = ${after.agent1.sigma},
            agent2_mu_before = ${before2.mu}, agent2_sigma_before = ${before2.sigma},
            agent2_mu_after = ${after.agent2.mu}, agent2_sigma_after = ${after.agent2.sigma},
            rating_delta_agent1 = ${rating1 - Number(a1.rating)}, rating_delta_agent2 = ${rating2 - Number(a2.rating)}
          WHERE id = ${ratedMatchId}
        `;
      }
    } else if (isInfra && match.kind === "rating") {
      await sql`UPDATE arena_agents SET error_matches = error_matches + 1 WHERE id IN (${match.agent1_id}, ${match.agent2_id})`;
    }

    void dispatchNextRatingTask();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Rating match callback failed:", error);
    return NextResponse.json({ error: "DB error." }, { status: 500 });
  }
}
