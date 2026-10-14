import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/friendly/challenges
 *
 * Lấy danh sách challenges của mình: received (nhận) và sent (đã gửi).
 * Query params:
 *   - type: "received" | "sent" | "all" (default "all")
 *   - status: "pending" | "accepted" | "declined" | "cancelled" | "expired" (default: tất cả)
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "all";
  const statusFilter = searchParams.get("status");
  const validStatuses = ["pending", "accepted", "declined", "cancelled", "expired"];

  try {
    // Tự động expire những challenge quá hạn
    await sql`
      UPDATE friendly_challenges
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < NOW()
    `;

    const BASE = `
      SELECT
        fc.id::int,
        fc.status,
        fc.message,
        fc.created_at,
        fc.responded_at,
        fc.expires_at,
        fc.friendly_match_id::int,

        -- Challenger info
        fc.challenger_id::int,
        uc.username AS challenger_username,
        ca.id::int AS challenger_agent_id,
        ca.agent_name AS challenger_agent_name,
        ca.rating AS challenger_agent_elo,

        -- Opponent info
        fc.opponent_id::int,
        uo.username AS opponent_username,
        oa.id::int AS opponent_agent_id,
        oa.agent_name AS opponent_agent_name,
        oa.rating AS opponent_agent_elo,

        -- Match result (nếu đã accepted và chạy xong)
        fm.status AS match_status,
        fm.outcome AS match_outcome,
        fm.total_moves AS match_total_moves,
        fm.pending_backend AS match_pending_backend,
        wna.agent_name AS match_winner_name

      FROM friendly_challenges fc
      JOIN users uc ON uc.id = fc.challenger_id
      JOIN users uo ON uo.id = fc.opponent_id
      JOIN arena_agents ca ON ca.id = fc.challenger_agent_id
      JOIN arena_agents oa ON oa.id = fc.opponent_agent_id
      LEFT JOIN friendly_matches fm ON fm.id = fc.friendly_match_id
      LEFT JOIN arena_agents wna ON wna.id = fm.winner_agent_id
    `;

    let rows: unknown[];
    const uid = Number(session.id);

    if (type === "received") {
      if (statusFilter && validStatuses.includes(statusFilter)) {
        rows = await sql`${sql.unsafe(BASE)}
          WHERE fc.opponent_id = ${uid} AND fc.status = ${statusFilter}
          ORDER BY fc.created_at DESC LIMIT 50`;
      } else {
        rows = await sql`${sql.unsafe(BASE)}
          WHERE fc.opponent_id = ${uid}
          ORDER BY fc.created_at DESC LIMIT 50`;
      }
    } else if (type === "sent") {
      if (statusFilter && validStatuses.includes(statusFilter)) {
        rows = await sql`${sql.unsafe(BASE)}
          WHERE fc.challenger_id = ${uid} AND fc.status = ${statusFilter}
          ORDER BY fc.created_at DESC LIMIT 50`;
      } else {
        rows = await sql`${sql.unsafe(BASE)}
          WHERE fc.challenger_id = ${uid}
          ORDER BY fc.created_at DESC LIMIT 50`;
      }
    } else {
      // all
      if (statusFilter && validStatuses.includes(statusFilter)) {
        rows = await sql`${sql.unsafe(BASE)}
          WHERE (fc.challenger_id = ${uid} OR fc.opponent_id = ${uid}) AND fc.status = ${statusFilter}
          ORDER BY fc.created_at DESC LIMIT 50`;
      } else {
        rows = await sql`${sql.unsafe(BASE)}
          WHERE (fc.challenger_id = ${uid} OR fc.opponent_id = ${uid})
          ORDER BY fc.created_at DESC LIMIT 50`;
      }
    }

    // Đếm pending received (dùng cho badge notification)
    const pendingCountRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM friendly_challenges
      WHERE opponent_id = ${uid} AND status = 'pending' AND expires_at > NOW()
    ` as { count: number }[];

    return NextResponse.json({
      challenges: rows,
      pending_received_count: Number(pendingCountRows[0]?.count ?? 0),
    });
  } catch (error) {
    console.error("List challenges failed:", error);
    return NextResponse.json({ error: "Không thể tải danh sách thách đấu." }, { status: 500 });
  }
}
