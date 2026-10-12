import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// ELO K factor
const K = 32;

function calcElo(
  ratingA: number,
  ratingB: number,
  outcome: "win" | "loss" | "draw",
): { newA: number; newB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const scoreA = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
  const deltaA = Math.round(K * (scoreA - expectedA));
  return {
    newA: ratingA + deltaA,
    newB: ratingB - deltaA,
  };
}

// POST: ghi nhận kết quả trận arena
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const { backend_match_id, agent1_id, agent2_id, winner_agent_id, win_reason, total_moves } =
    body as {
      backend_match_id?: unknown;
      agent1_id?: unknown;
      agent2_id?: unknown;
      winner_agent_id?: unknown;
      win_reason?: unknown;
      total_moves?: unknown;
    };

  if (
    typeof backend_match_id !== "string" ||
    typeof agent1_id !== "number" ||
    typeof agent2_id !== "number"
  ) {
    return NextResponse.json({ error: "Thiếu thông tin trận đấu." }, { status: 400 });
  }

  try {
    // Lấy ELO hiện tại của 2 agent
    const agentRows = await sql`
      SELECT id, elo, wins, losses, draws
      FROM arena_agents
      WHERE id IN (${agent1_id}, ${agent2_id})
    `;

    if (agentRows.length !== 2) {
      return NextResponse.json({ error: "Không tìm thấy agent." }, { status: 404 });
    }

    const a1 = agentRows.find((r) => r.id === agent1_id) as {
      id: number; elo: number; wins: number; losses: number; draws: number;
    };
    const a2 = agentRows.find((r) => r.id === agent2_id) as {
      id: number; elo: number; wins: number; losses: number; draws: number;
    };

    // Tính ELO mới
    let outcome: "win" | "loss" | "draw" = "draw";
    if (winner_agent_id === agent1_id) outcome = "win";
    else if (winner_agent_id === agent2_id) outcome = "loss";

    const { newA, newB } = calcElo(a1.elo, a2.elo, outcome);

    const winnerId =
      typeof winner_agent_id === "number" ? winner_agent_id : null;
    const winReason =
      typeof win_reason === "string" ? win_reason.slice(0, 500) : "";
    const moves = typeof total_moves === "number" ? total_moves : 0;

    // Ghi trận đấu
    await sql`
      INSERT INTO arena_matches
        (backend_match_id, agent1_id, agent2_id, winner_agent_id, win_reason, total_moves, status, finished_at)
      VALUES
        (${backend_match_id}, ${agent1_id}, ${agent2_id}, ${winnerId}, ${winReason}, ${moves}, 'finished', NOW())
    `;

    // Cập nhật stats agent 1
    await sql`
      UPDATE arena_agents SET
        elo = ${newA},
        wins = wins + ${outcome === "win" ? 1 : 0},
        losses = losses + ${outcome === "loss" ? 1 : 0},
        draws = draws + ${outcome === "draw" ? 1 : 0}
      WHERE id = ${agent1_id}
    `;

    // Cập nhật stats agent 2
    await sql`
      UPDATE arena_agents SET
        elo = ${newB},
        wins = wins + ${outcome === "loss" ? 1 : 0},
        losses = losses + ${outcome === "win" ? 1 : 0},
        draws = draws + ${outcome === "draw" ? 1 : 0}
      WHERE id = ${agent2_id}
    `;

    return NextResponse.json({
      ok: true,
      elo: { agent1: { old: a1.elo, new: newA }, agent2: { old: a2.elo, new: newB } },
    });
  } catch (error) {
    console.error("Arena record match failed:", error);
    return NextResponse.json({ error: "Không thể lưu kết quả trận." }, { status: 500 });
  }
}

// GET: lịch sử trận đấu arena
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }

  try {
    const rows = await sql`
      SELECT
        m.id,
        m.backend_match_id,
        m.status,
        m.total_moves,
        m.win_reason,
        m.played_at,
        a1.agent_name AS agent1_name,
        u1.username AS agent1_username,
        a2.agent_name AS agent2_name,
        u2.username AS agent2_username,
        w.agent_name AS winner_name
      FROM arena_matches m
      JOIN arena_agents a1 ON a1.id = m.agent1_id
      JOIN users u1 ON u1.id = a1.user_id
      JOIN arena_agents a2 ON a2.id = m.agent2_id
      JOIN users u2 ON u2.id = a2.user_id
      LEFT JOIN arena_agents w ON w.id = m.winner_agent_id
      ORDER BY m.played_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ matches: rows });
  } catch (error) {
    console.error("Arena matches failed:", error);
    return NextResponse.json({ error: "Không thể tải lịch sử trận đấu." }, { status: 500 });
  }
}
