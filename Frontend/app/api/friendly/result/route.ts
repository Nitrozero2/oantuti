import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/friendly/result
 *
 * Callback endpoint - worker POST kết quả về đây sau khi chạy xong trận.
 * Không cần auth (internal call từ worker).
 *
 * event="started" → set status='running'
 * event="finished" → update kết quả + insert move history
 */
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const {
    event,
    friendly_match_id,
    outcome,
    winner_agent_id,
    win_reason,
    total_moves,
    is_infra_error,
    moves_history,
  } = body as Record<string, unknown>;

  if (typeof friendly_match_id !== "number")
    return NextResponse.json({ error: "friendly_match_id required." }, { status: 400 });

  // ── event: started ─────────────────────────────────────────────────────────
  if (event === "started") {
    try {
      await sql`
        UPDATE friendly_matches
        SET status = 'running'
        WHERE id = ${friendly_match_id} AND status IN ('scheduled', 'running')
      `;
      return NextResponse.json({ ok: true, event: "started" });
    } catch (err) {
      console.error("friendly/result started failed:", err);
      return NextResponse.json({ error: "DB error." }, { status: 500 });
    }
  }

  // ── event: finished ────────────────────────────────────────────────────────
  const isInfra = is_infra_error === true;
  const outcomeStr = typeof outcome === "string" ? outcome : null;
  const winnerAgentId = typeof winner_agent_id === "number" ? winner_agent_id : null;
  const winReasonStr = typeof win_reason === "string" ? win_reason.slice(0, 500) : "";
  const totalMovesNum = typeof total_moves === "number" ? total_moves : 0;
  const history = Array.isArray(moves_history)
    ? moves_history as Array<{
        move_number: number; player: number;
        from_col: number; from_row: number; to_col: number; to_row: number;
        from_pos: string; to_pos: string;
        piece_type?: string | null; captured_type?: string | null;
      }>
    : [];

  try {
    const matchStatus = isInfra ? "error" : "finished";

    await sql`
      UPDATE friendly_matches SET
        status        = ${matchStatus},
        outcome       = ${outcomeStr},
        winner_agent_id = ${winnerAgentId},
        win_reason    = ${winReasonStr},
        total_moves   = ${totalMovesNum},
        is_infra_error = ${isInfra},
        pending_backend = false,
        finished_at   = NOW()
      WHERE id = ${friendly_match_id}
    `;

    // Insert move history
    for (const mv of history) {
      await sql`
        INSERT INTO friendly_match_history
          (friendly_match_id, move_number, player,
           from_col, from_row, to_col, to_row,
           from_pos, to_pos, captured_type)
        VALUES
          (${friendly_match_id}, ${mv.move_number}, ${mv.player},
           ${mv.from_col}, ${mv.from_row}, ${mv.to_col}, ${mv.to_row},
           ${mv.from_pos}, ${mv.to_pos}, ${mv.captured_type ?? null})
        ON CONFLICT (friendly_match_id, move_number) DO NOTHING
      `;
    }

    return NextResponse.json({ ok: true, event: "finished" });
  } catch (err) {
    console.error("friendly/result finished failed:", err);
    return NextResponse.json({ error: "DB error." }, { status: 500 });
  }
}
