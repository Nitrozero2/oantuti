import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/arena/agents/all-active
 * Returns all active agents (from all users) for the friendly match selector.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  try {
    const rows = await sql`
      SELECT
        a.id,
        a.agent_name,
        a.elo,
        a.status,
        a.user_id,
        u.username
      FROM arena_agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.status = 'active'
      ORDER BY u.username ASC, a.elo DESC
    `;
    return NextResponse.json({ agents: rows });
  } catch (error) {
    console.error("Fetch all-active agents failed:", error);
    return NextResponse.json({ error: "Không thể tải danh sách agent." }, { status: 500 });
  }
}
