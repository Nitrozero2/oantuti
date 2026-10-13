import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/friendly/challenge
 *
 * Gửi lời thách đấu tới một user khác.
 *
 * Body:
 * {
 *   challenger_agent_id: number   -- agent của mình
 *   opponent_agent_id: number     -- agent của đối thủ muốn đấu với
 *   message?: string              -- tin nhắn tùy chọn
 * }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const { challenger_agent_id, opponent_agent_id, message } = body as Record<string, unknown>;

  if (typeof challenger_agent_id !== "number" || typeof opponent_agent_id !== "number") {
    return NextResponse.json({ error: "Cần challenger_agent_id và opponent_agent_id." }, { status: 400 });
  }
  if (challenger_agent_id === opponent_agent_id) {
    return NextResponse.json({ error: "Hai agent phải khác nhau." }, { status: 400 });
  }

  const msg = typeof message === "string" ? message.trim().slice(0, 200) : "";

  try {
    // Load cả 2 agents
    const agents = await sql`
      SELECT a.id::int, a.user_id::int, a.status, a.agent_name, u.username
      FROM arena_agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.id IN (${challenger_agent_id}, ${opponent_agent_id})
    ` as { id: number; user_id: number; status: string; agent_name: string; username: string }[];

    if (agents.length !== 2) {
      return NextResponse.json({ error: "Không tìm thấy một hoặc cả hai agent." }, { status: 404 });
    }

    const myAgent = agents.find(a => Number(a.id) === challenger_agent_id);
    const theirAgent = agents.find(a => Number(a.id) === opponent_agent_id);

    if (!myAgent || !theirAgent) {
      return NextResponse.json({ error: "Agent không hợp lệ." }, { status: 400 });
    }

    // Challenger phải sở hữu agent của mình
    if (Number(myAgent.user_id) !== Number(session.id)) {
      return NextResponse.json({ error: "Bạn không sở hữu agent này." }, { status: 403 });
    }

    // Không thể thách đấu chính mình
    if (Number(myAgent.user_id) === Number(theirAgent.user_id)) {
      return NextResponse.json({ error: "Không thể thách đấu agent của chính mình." }, { status: 400 });
    }

    // Cả 2 agent phải active
    if (myAgent.status !== "active") {
      return NextResponse.json({ error: "Agent của bạn phải ở trạng thái 'active'." }, { status: 400 });
    }
    if (theirAgent.status !== "active") {
      return NextResponse.json({ error: `Agent "${theirAgent.agent_name}" của đối thủ chưa active.` }, { status: 400 });
    }

    const opponentId = Number(theirAgent.user_id);

    // Kiểm tra có challenge pending nào giữa 2 cặp agent này chưa
    const existing = await sql`
      SELECT id FROM friendly_challenges
      WHERE challenger_id = ${session.id}
        AND challenger_agent_id = ${challenger_agent_id}
        AND opponent_agent_id = ${opponent_agent_id}
        AND status = 'pending'
        AND expires_at > NOW()
    `;
    if (existing.length > 0) {
      return NextResponse.json({
        error: "Bạn đã có lời thách đấu đang chờ với cặp agent này.",
      }, { status: 409 });
    }

    // Tạo challenge
    const rows = await sql`
      INSERT INTO friendly_challenges
        (challenger_id, challenger_agent_id, opponent_id, opponent_agent_id, message)
      VALUES
        (${session.id}, ${challenger_agent_id}, ${opponentId}, ${opponent_agent_id}, ${msg})
      RETURNING id
    `;
    const challengeId = Number((rows[0] as { id: number }).id);

    return NextResponse.json({
      ok: true,
      challenge_id: challengeId,
      opponent_username: theirAgent.username,
      message: `Đã gửi lời thách đấu tới @${theirAgent.username}!`,
    });
  } catch (error) {
    console.error("Create challenge failed:", error);
    return NextResponse.json({ error: "Không thể gửi lời thách đấu." }, { status: 500 });
  }
}
