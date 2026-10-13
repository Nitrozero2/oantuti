import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/tournament/sessions-public
 *
 * Danh sách sessions công khai (chỉ thông tin cơ bản, không có config/notes).
 * Dùng cho leaderboard page — bất kỳ user đăng nhập nào cũng được xem.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  try {
    const rows = await sql`
      SELECT
        s.id,
        s.name,
        s.status,
        s.created_at,
        s.started_at,
        s.completed_at,
        COUNT(m.id)::int                                              AS total_matches,
        COUNT(m.id) FILTER (WHERE m.status = 'finished')::int        AS finished_matches,
        COUNT(m.id) FILTER (WHERE m.status = 'error')::int           AS error_matches,
        COUNT(m.id) FILTER (WHERE m.status = 'scheduled')::int       AS scheduled_matches
      FROM tournament_sessions s
      LEFT JOIN tournament_matches m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ sessions: rows });
  } catch (error) {
    console.error("Public sessions list failed:", error);
    return NextResponse.json({ error: "Không thể tải danh sách session." }, { status: 500 });
  }
}
