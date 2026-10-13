import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST /api/tournament/sessions/[id]/confirm-pairs
 *
 * Xác nhận và insert các cặp đấu đã được admin chọn vào tournament_matches.
 *
 * Body:
 * {
 *   pairs: Array<{ agent1_id: number; agent2_id: number }>
 * }
 *
 * Mỗi pair phải là cặp cross-user hợp lệ của active agents.
 * Dùng ON CONFLICT DO NOTHING để idempotent.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userSession = await getSession();
  if (!userSession?.is_admin) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json({ error: "Session ID không hợp lệ." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const { pairs } = body as {
    pairs?: Array<{ agent1_id: number; agent2_id: number }>;
  };

  if (!Array.isArray(pairs) || pairs.length === 0) {
    return NextResponse.json({ error: "Cần ít nhất 1 cặp đấu." }, { status: 400 });
  }

  // Validate pair format
  for (const p of pairs) {
    if (
      typeof p.agent1_id !== "number" ||
      typeof p.agent2_id !== "number" ||
      p.agent1_id === p.agent2_id
    ) {
      return NextResponse.json(
        { error: "Cặp đấu không hợp lệ (agent1_id === agent2_id hoặc sai kiểu dữ liệu)." },
        { status: 400 },
      );
    }
  }

  try {
    // Kiểm tra session tồn tại và đang ở trạng thái idle
    const sessionRows = await sql`
      SELECT id, status FROM tournament_sessions WHERE id = ${sessionId}
    ` as { id: number; status: string }[];

    if (sessionRows.length === 0) {
      return NextResponse.json({ error: "Session không tồn tại." }, { status: 404 });
    }

    const sess = sessionRows[0];
    if (sess.status !== "idle") {
      return NextResponse.json(
        { error: `Session đang ở trạng thái '${sess.status}', chỉ có thể confirm khi idle.` },
        { status: 409 },
      );
    }

    // Lấy tất cả active agents để validate các pair gửi lên
    const activeAgents = await sql`
      SELECT a.id, a.user_id
      FROM arena_agents a
      WHERE a.status = 'active'
    ` as { id: number; user_id: number }[];

    const agentUserMap = new Map(activeAgents.map((a) => [a.id, a.user_id]));

    // Lọc chỉ các pair hợp lệ (cả 2 agent active, khác user)
    const validPairs: Array<[number, number]> = [];
    const skipped: Array<{ agent1_id: number; agent2_id: number; reason: string }> = [];

    for (const p of pairs) {
      const user1 = agentUserMap.get(p.agent1_id);
      const user2 = agentUserMap.get(p.agent2_id);

      if (user1 === undefined) {
        skipped.push({ ...p, reason: `agent1_id ${p.agent1_id} không active` });
        continue;
      }
      if (user2 === undefined) {
        skipped.push({ ...p, reason: `agent2_id ${p.agent2_id} không active` });
        continue;
      }
      if (user1 === user2) {
        skipped.push({ ...p, reason: "Cùng user" });
        continue;
      }
      validPairs.push([p.agent1_id, p.agent2_id]);
    }

    if (validPairs.length === 0) {
      return NextResponse.json(
        { error: "Không có cặp đấu hợp lệ nào. Kiểm tra lại agents.", skipped },
        { status: 400 },
      );
    }

    // Bulk insert
    let inserted = 0;
    for (const [a1, a2] of validPairs) {
      const result = await sql`
        INSERT INTO tournament_matches (session_id, agent1_id, agent2_id, status)
        VALUES (${sessionId}, ${a1}, ${a2}, 'scheduled')
        ON CONFLICT (session_id, agent1_id, agent2_id) DO NOTHING
        RETURNING id
      ` as { id: number }[];
      if (result.length > 0) inserted++;
    }

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      inserted,
      skipped_count: pairs.length - validPairs.length,
      skipped,
    });
  } catch (error) {
    console.error("Confirm pairs failed:", error);
    return NextResponse.json({ error: "Không thể xác nhận cặp đấu." }, { status: 500 });
  }
}
