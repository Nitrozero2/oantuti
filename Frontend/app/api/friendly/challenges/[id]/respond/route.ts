import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/friendly/challenges/[id]/respond
 *
 * Chấp nhận hoặc từ chối lời thách đấu.
 *
 * Body: { action: "accept" | "decline" }
 *
 * Nếu accept:
 *   - Tạo friendly_match với pending_backend=true, status='scheduled'
 *   - Update challenge.friendly_match_id
 *   - Match sẽ tự chạy khi backend online qua /api/friendly/process-pending
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  const { id } = await params;
  const challengeId = parseInt(id, 10);
  if (!Number.isInteger(challengeId) || challengeId <= 0) {
    return NextResponse.json({ error: "Challenge ID không hợp lệ." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const { action } = body as { action?: string };
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action phải là 'accept' hoặc 'decline'." }, { status: 400 });
  }

  try {
    // Load challenge
    const rows = await sql`
      SELECT
        fc.id::int, fc.status, fc.expires_at,
        fc.challenger_id::int, fc.opponent_id::int,
        fc.challenger_agent_id::int, fc.opponent_agent_id::int,
        ca.code AS challenger_code, ca.status AS challenger_agent_status,
        oa.code AS opponent_code, oa.status AS opponent_agent_status
      FROM friendly_challenges fc
      JOIN arena_agents ca ON ca.id = fc.challenger_agent_id
      JOIN arena_agents oa ON oa.id = fc.opponent_agent_id
      WHERE fc.id = ${challengeId}
    ` as {
      id: number; status: string; expires_at: string;
      challenger_id: number; opponent_id: number;
      challenger_agent_id: number; opponent_agent_id: number;
      challenger_code: string; challenger_agent_status: string;
      opponent_code: string; opponent_agent_status: string;
    }[];

    if (rows.length === 0) {
      return NextResponse.json({ error: "Lời thách đấu không tồn tại." }, { status: 404 });
    }

    const challenge = rows[0];

    // Chỉ opponent mới được respond
    if (Number(challenge.opponent_id) !== Number(session.id)) {
      return NextResponse.json({ error: "Bạn không phải người nhận lời thách đấu này." }, { status: 403 });
    }

    if (challenge.status !== "pending") {
      return NextResponse.json({
        error: `Lời thách đấu đã ở trạng thái '${challenge.status}', không thể phản hồi nữa.`,
      }, { status: 409 });
    }

    if (new Date(challenge.expires_at) < new Date()) {
      await sql`UPDATE friendly_challenges SET status = 'expired' WHERE id = ${challengeId}`;
      return NextResponse.json({ error: "Lời thách đấu đã hết hạn." }, { status: 410 });
    }

    if (action === "decline") {
      await sql`
        UPDATE friendly_challenges
        SET status = 'declined', responded_at = NOW()
        WHERE id = ${challengeId}
      `;
      return NextResponse.json({ ok: true, action: "declined" });
    }

    // ACCEPT:

    // Kiểm tra agents vẫn còn active
    if (challenge.challenger_agent_status !== "active") {
      return NextResponse.json({
        error: "Agent của người thách đấu đã không còn active. Không thể chấp nhận.",
      }, { status: 409 });
    }
    if (challenge.opponent_agent_status !== "active") {
      return NextResponse.json({
        error: "Agent của bạn đã không còn active. Không thể chấp nhận.",
      }, { status: 409 });
    }

    // Tạo friendly_match với pending_backend = true
    // agent1 = challenger, agent2 = opponent (giữ nhất quán với challenge)
    const fmRows = await sql`
      INSERT INTO friendly_matches
        (created_by, agent1_id, agent2_id, status, pending_backend,
         challenger_id, opponent_id, is_public)
      VALUES
        (${challenge.challenger_id},
         ${challenge.challenger_agent_id},
         ${challenge.opponent_agent_id},
         'scheduled',
         true,
         ${challenge.challenger_id},
         ${challenge.opponent_id},
         true)
      RETURNING id
    `;
    const friendlyMatchId = Number((fmRows[0] as { id: number }).id);

    // Update challenge
    await sql`
      UPDATE friendly_challenges
      SET status = 'accepted', responded_at = NOW(), friendly_match_id = ${friendlyMatchId}
      WHERE id = ${challengeId}
    `;

    return NextResponse.json({
      ok: true,
      action: "accepted",
      friendly_match_id: friendlyMatchId,
      message: "Đã chấp nhận! Trận đấu sẽ tự động chạy khi backend online.",
    });
  } catch (error) {
    console.error("Respond challenge failed:", error);
    return NextResponse.json({ error: "Không thể phản hồi lời thách đấu." }, { status: 500 });
  }
}
