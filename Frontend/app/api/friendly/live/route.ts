import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { backendFetch, isBackendOnline, BACKEND_OFFLINE_MESSAGE } from "@/lib/backend";

export const runtime = "nodejs";
// No response caching — this is a streaming endpoint
export const dynamic = "force-dynamic";

type StepEvent = {
  type: "step";
  step_number: number;
  player: number;
  move: { from_col: number; from_row: number; to_col: number; to_row: number; from_pos: string; to_pos: string } | null;
  captured_type: string | null;
  game_over: boolean;
  winner: number | null;
  win_reason: string;
  error: string | null;
};

type DoneEvent = {
  type: "done";
  friendly_match_id: number;
  outcome: string;
  total_moves: number;
  win_reason: string;
};

type ErrorEvent = {
  type: "error";
  message: string;
  backend_offline?: boolean;
};

function sseMessage(data: StepEvent | DoneEvent | ErrorEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * GET /api/friendly/live?agent1_id=X&agent2_id=Y
 * SSE stream: creates a match, runs step-by-step, streams each move as an event.
 * On finish, saves to DB and emits "done".
 *
 * Khi backend offline: gửi ngay 1 error event, đóng stream — không hang.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agent1IdRaw = searchParams.get("agent1_id");
  const agent2IdRaw = searchParams.get("agent2_id");
  const agent1_id = agent1IdRaw ? parseInt(agent1IdRaw, 10) : null;
  const agent2_id = agent2IdRaw ? parseInt(agent2IdRaw, 10) : null;

  if (!agent1_id || !agent2_id || isNaN(agent1_id) || isNaN(agent2_id)) {
    return new Response("Missing agent ids", { status: 400 });
  }
  if (agent1_id === agent2_id) {
    return new Response("Agents must differ", { status: 400 });
  }

  // Validate agents up-front before opening stream
  const agentRows = await sql`
    SELECT id, user_id, code, status FROM arena_agents WHERE id IN (${agent1_id}, ${agent2_id})
  ` as { id: number; user_id: number; code: string; status: string }[];

  if (agentRows.length !== 2) {
    return new Response("Agents not found", { status: 404 });
  }
  const a1 = agentRows.find(a => Number(a.id) === agent1_id)!;
  const a2 = agentRows.find(a => Number(a.id) === agent2_id)!;

  if (Number(a1.user_id) === Number(a2.user_id)) {
    return new Response("Agents must belong to different users", { status: 400 });
  }
  if (a1.status !== "active" || a2.status !== "active") {
    return new Response("Both agents must be active", { status: 400 });
  }

  // Kiểm tra backend trước khi tạo DB record và mở stream
  const online = await isBackendOnline();
  if (!online) {
    // Trả về SSE stream ngay với 1 error event rồi đóng
    const encoder = new TextEncoder();
    const body = sseMessage({ type: "error", message: BACKEND_OFFLINE_MESSAGE, backend_offline: true });
    return new Response(encoder.encode(body), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Create DB record
  const fmRows = await sql`
    INSERT INTO friendly_matches (created_by, agent1_id, agent2_id, status)
    VALUES (${session.id}, ${agent1_id}, ${agent2_id}, 'running')
    RETURNING id
  `;
  const friendlyMatchId = Number((fmRows[0] as { id: number }).id);

  // Create backend match
  const createResult = await backendFetch("/matches/", {
    method: "POST",
    body: JSON.stringify({ agent1_code: a1.code, agent2_code: a2.code, max_moves: 300 }),
    timeoutMs: 8_000,
  });

  if (!createResult.ok) {
    await sql`UPDATE friendly_matches SET status='error', is_infra_error=true WHERE id=${friendlyMatchId}`;
    const encoder = new TextEncoder();
    const body = sseMessage({
      type: "error",
      message: createResult.error,
      backend_offline: createResult.isOffline,
    });
    return new Response(encoder.encode(body), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const backendMatchId = (createResult.data as { match_id: string }).match_id;

  // SSE stream
  const encoder = new TextEncoder();
  const steps: Array<{
    step_number: number; player: number;
    move?: { from_col: number; from_row: number; to_col: number; to_row: number; from_pos: string; to_pos: string };
    captured?: { type: string }; game_over: boolean; winner: number | null;
    win_reason: string; error?: string | null;
  }> = [];

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: StepEvent | DoneEvent | ErrorEvent) {
        controller.enqueue(encoder.encode(sseMessage(data)));
      }

      try {
        // Step through the match
        let gameOver = false;
        let stepNum = 0;
        const MAX_STEPS = 310;

        while (!gameOver && stepNum < MAX_STEPS) {
          const stepResult = await backendFetch(`/matches/${backendMatchId}/step`, {
            method: "POST",
            timeoutMs: 15_000, // 15s per step (Judge0 có thể chậm)
          });

          if (!stepResult.ok) {
            send({
              type: "error",
              message: stepResult.error,
              backend_offline: stepResult.isOffline,
            });
            break;
          }

          const step = stepResult.data as {
            step_number: number; player: number;
            move?: { from_col: number; from_row: number; to_col: number; to_row: number; from_pos: string; to_pos: string } | null;
            captured?: { player: number; type: string } | null;
            game_over: boolean; winner: number | null; win_reason: string; error?: string | null;
          };

          stepNum = step.step_number;
          gameOver = step.game_over;
          steps.push({
            step_number: step.step_number,
            player: step.player,
            move: step.move ?? undefined,
            captured: step.captured ? { type: step.captured.type } : undefined,
            game_over: step.game_over,
            winner: step.winner,
            win_reason: step.win_reason,
            error: step.error,
          });

          // Stream this step to client
          send({
            type: "step",
            step_number: step.step_number,
            player: step.player,
            move: step.move ?? null,
            captured_type: step.captured?.type ?? null,
            game_over: step.game_over,
            winner: step.winner,
            win_reason: step.win_reason,
            error: step.error ?? null,
          });

          if (gameOver) break;
        }

        // Save results to DB
        const lastStep = steps[steps.length - 1];
        const winner = lastStep?.winner ?? null;
        const outcome = winner === 1 ? "agent1" : winner === 2 ? "agent2" : "draw";
        const winnerAgentId = winner === 1 ? agent1_id : winner === 2 ? agent2_id : null;
        const totalMoves = steps.filter(s => s.move).length;
        const winReason = lastStep?.win_reason ?? "";

        await sql`
          UPDATE friendly_matches SET
            status = 'finished', backend_match_id = ${backendMatchId},
            outcome = ${outcome}, winner_agent_id = ${winnerAgentId},
            win_reason = ${winReason}, total_moves = ${totalMoves},
            finished_at = NOW()
          WHERE id = ${friendlyMatchId}
        `;

        // Bulk insert move history
        for (const s of steps) {
          if (s.move) {
            await sql`
              INSERT INTO friendly_match_history
                (friendly_match_id, move_number, player, from_col, from_row, to_col, to_row, from_pos, to_pos, captured_type)
              VALUES
                (${friendlyMatchId}, ${s.step_number}, ${s.player},
                 ${s.move.from_col}, ${s.move.from_row}, ${s.move.to_col}, ${s.move.to_row},
                 ${s.move.from_pos}, ${s.move.to_pos}, ${s.captured?.type ?? null})
              ON CONFLICT (friendly_match_id, move_number) DO NOTHING
            `;
          }
        }

        // Cleanup backend match (fire-and-forget)
        backendFetch(`/matches/${backendMatchId}`, { method: "DELETE", timeoutMs: 5_000 }).catch(() => {});

        send({ type: "done", friendly_match_id: friendlyMatchId, outcome, total_moves: totalMoves, win_reason: winReason });

      } catch (err) {
        console.error("Live match stream error:", err);
        send({ type: "error", message: String(err) });
        await sql`UPDATE friendly_matches SET status='error', is_infra_error=true WHERE id=${friendlyMatchId}`.catch(() => {});
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
