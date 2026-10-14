import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { backendFetch, isBackendOnline } from "@/lib/backend";

export const runtime = "nodejs";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

/**
 * POST /api/friendly/process-pending
 *
 * Enqueue tất cả friendly matches đang pending vào worker queue.
 * Worker sẽ tự chạy local engine và callback kết quả về.
 *
 * Trước: frontend tự chạy từng nước đi → chậm, timeout
 * Sau: chỉ enqueue vào queue, worker xử lý async
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  let body: { match_id?: number } = {};
  try { body = (await request.json()) as { match_id?: number }; } catch { /* ok */ }

  const specificMatchId = typeof body.match_id === "number" ? body.match_id : null;

  if (!session.is_admin && specificMatchId === null)
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });

  const online = await isBackendOnline();
  if (!online)
    return NextResponse.json({ ok: false, message: "Backend đang offline.", backend_online: false }, { status: 503 });

  try {
    // Lấy danh sách pending
    let pendingMatches: {
      id: number; agent1_id: number; agent1_code: string;
      agent2_id: number; agent2_code: string;
      challenger_id?: number; opponent_id?: number;
    }[];

    if (specificMatchId !== null) {
      const rows = await sql`
        SELECT fm.id::int, fm.agent1_id::int, a1.code AS agent1_code,
               fm.agent2_id::int, a2.code AS agent2_code,
               fm.challenger_id::int, fm.opponent_id::int
        FROM friendly_matches fm
        JOIN arena_agents a1 ON a1.id = fm.agent1_id
        JOIN arena_agents a2 ON a2.id = fm.agent2_id
        WHERE fm.id = ${specificMatchId}
          AND fm.pending_backend = true AND fm.status = 'scheduled'
      ` as { id: number; agent1_id: number; agent1_code: string;
             agent2_id: number; agent2_code: string;
             challenger_id: number; opponent_id: number }[];

      if (rows.length === 0)
        return NextResponse.json({ error: "Trận không tồn tại hoặc không pending." }, { status: 404 });

      const m = rows[0];
      if (!session.is_admin &&
          Number(m.challenger_id) !== Number(session.id) &&
          Number(m.opponent_id) !== Number(session.id))
        return NextResponse.json({ error: "Không có quyền." }, { status: 403 });

      pendingMatches = rows;
    } else {
      const rows = await sql`
        SELECT fm.id::int, fm.agent1_id::int, a1.code AS agent1_code,
               fm.agent2_id::int, a2.code AS agent2_code
        FROM friendly_matches fm
        JOIN arena_agents a1 ON a1.id = fm.agent1_id
        JOIN arena_agents a2 ON a2.id = fm.agent2_id
        WHERE fm.pending_backend = true AND fm.status = 'scheduled'
        ORDER BY fm.created_at ASC LIMIT 50
      ` as { id: number; agent1_id: number; agent1_code: string;
             agent2_id: number; agent2_code: string }[];
      pendingMatches = rows;
    }

    if (pendingMatches.length === 0)
      return NextResponse.json({ ok: true, message: "Không có trận nào đang chờ.", queued: 0 });

    // Enqueue tất cả vào worker queue
    let queued = 0;
    let errors = 0;
    const results = [];

    for (const match of pendingMatches) {
      const r = await backendFetch("/friendly/enqueue", {
        method: "POST",
        body: JSON.stringify({
          friendly_match_id: match.id,
          agent1_id: match.agent1_id,
          agent1_code: match.agent1_code,
          agent2_id: match.agent2_id,
          agent2_code: match.agent2_code,
          max_moves: 300,
          callback_url: FRONTEND_URL,
        }),
        timeoutMs: 10_000,
      });

      if (r.ok) {
        queued++;
        results.push({ match_id: match.id, queued: true });
      } else {
        errors++;
        results.push({ match_id: match.id, queued: false, error: r.error });
      }
    }

    return NextResponse.json({ ok: true, backend_online: true, queued, errors, results });
  } catch (error) {
    console.error("Process pending failed:", error);
    return NextResponse.json({ error: "Lỗi xử lý." }, { status: 500 });
  }
}
