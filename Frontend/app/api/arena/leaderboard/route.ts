import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  try {
    const rows = await sql`
      SELECT
        a.id AS agent_id,
        a.agent_name,
        a.description,
        a.version,
        a.status,
        a.rating AS elo,
        a.wins,
        a.losses,
        a.draws,
        a.error_matches,
        a.submitted_at,
        u.username,
        (a.wins + a.losses + a.draws) AS total_games,
        CASE
          WHEN (a.wins + a.losses + a.draws) = 0 THEN 0
          ELSE ROUND(a.wins::numeric / (a.wins + a.losses + a.draws) * 100, 1)
        END AS win_rate
      FROM arena_agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.status = 'active'
      ORDER BY a.rating DESC, a.wins DESC, a.submitted_at ASC
      LIMIT 100
    `;
    return NextResponse.json({ leaderboard: rows });
  } catch (error) {
    console.error("Arena leaderboard failed:", error);
    return NextResponse.json(
      { error: "Không thể tải bảng xếp hạng. Hãy chạy tournament_schema.sql trước." },
      { status: 500 },
    );
  }
}
