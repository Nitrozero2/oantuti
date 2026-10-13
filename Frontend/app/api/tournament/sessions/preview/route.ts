import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * GET /api/tournament/sessions/preview
 * 
 * Trả về danh sách các cặp đấu sẽ được tạo nếu mở session mới,
 * kèm thông tin đã từng đấu nhau chưa (trong session nào, kết quả gì).
 * 
 * Query params:
 *   - include_prev_session_pairs: "true" | "false" (default false)
 *     Nếu false: loại bỏ các cặp đã đấu trong session trước (session gần nhất)
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const includePrev = searchParams.get("include_prev_session_pairs") === "true";

  try {
    // Lấy tất cả active agents
    // Cast về number ngay từ DB để tránh BIGINT → string mismatch
    const agentsRaw = await sql`
      SELECT
        a.id::int AS agent_id,
        a.user_id::int,
        a.agent_name,
        u.username
      FROM arena_agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.status = 'active'
      ORDER BY a.user_id, a.id
    ` as { agent_id: number; user_id: number; agent_name: string; username: string }[];
    const agents = agentsRaw.map((a) => ({
      ...a,
      agent_id: Number(a.agent_id),
      user_id: Number(a.user_id),
    }));

    if (agents.length < 2) {
      return NextResponse.json({
        pairs: [],
        agents: agents,
        warning: "Cần ít nhất 2 agent active từ 2 người dùng khác nhau.",
      });
    }

    // Lấy lịch sử tất cả cặp đã đấu trong tournament_matches (finished hoặc error)
    // Group by (min(agent1_id, agent2_id), max(agent1_id, agent2_id)) để normalize
    const history = await sql`
      SELECT
        LEAST(m.agent1_id, m.agent2_id)::int    AS bot_a,
        GREATEST(m.agent1_id, m.agent2_id)::int AS bot_b,
        m.session_id::int,
        ts.name AS session_name,
        m.outcome,
        m.status,
        m.finished_at,
        ts.created_at AS session_created_at
      FROM tournament_matches m
      JOIN tournament_sessions ts ON ts.id = m.session_id
      WHERE m.status IN ('finished', 'error')
      ORDER BY ts.created_at DESC
    ` as {
      bot_a: number; bot_b: number;
      session_id: number; session_name: string;
      outcome: string | null; status: string;
      finished_at: string | null; session_created_at: string;
    }[];

    // Normalize về number (phòng Neon trả BIGINT dạng string)
    const historyNorm = history.map((h) => ({
      ...h,
      bot_a: Number(h.bot_a),
      bot_b: Number(h.bot_b),
      session_id: Number(h.session_id),
    }));

    // Lấy session gần nhất (để xác định "session trước")
    const prevSessionRows = await sql`
      SELECT id, name, created_at
      FROM tournament_sessions
      ORDER BY created_at DESC
      LIMIT 1
    ` as { id: number; name: string; created_at: string }[];
    const prevSession = prevSessionRows[0] ?? null;

    // Tạo lookup map: "botA_botB" → mảng lịch sử
    const historyMap = new Map<string, typeof historyNorm>();
    for (const h of historyNorm) {
      const key = `${h.bot_a}_${h.bot_b}`;
      if (!historyMap.has(key)) historyMap.set(key, []);
      historyMap.get(key)!.push(h);
    }

    // Tạo set các cặp đã đấu trong session trước nhất
    const prevSessionPairs = new Set<string>();
    if (prevSession) {
      for (const h of historyNorm) {
        if (h.session_id === Number(prevSession.id)) {
          prevSessionPairs.add(`${h.bot_a}_${h.bot_b}`);
        }
      }
    }

    // Tạo tất cả cặp đấu cross-user
    const pairs: Array<{
      agent1_id: number;
      agent1_name: string;
      agent1_username: string;
      agent2_id: number;
      agent2_name: string;
      agent2_username: string;
      key: string;
      fight_count: number;
      last_session_id: number | null;
      last_session_name: string | null;
      last_outcome: string | null;
      played_in_prev_session: boolean;
      history_summary: Array<{
        session_id: number;
        session_name: string;
        outcome: string | null;
        finished_at: string | null;
      }>;
    }> = [];

    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a1 = agents[i];
        const a2 = agents[j];

        // Chỉ ghép cross-user
        if (a1.user_id === a2.user_id) continue;

        const bot_a = Math.min(a1.agent_id, a2.agent_id);
        const bot_b = Math.max(a1.agent_id, a2.agent_id);
        const key = `${bot_a}_${bot_b}`;

        const pairHistory = historyMap.get(key) ?? [];
        const playedInPrev = prevSessionPairs.has(key);

        // Nếu không include_prev và cặp đã đấu session trước → bỏ qua
        if (!includePrev && playedInPrev) continue;

        const lastFight = pairHistory[0] ?? null;

        pairs.push({
          agent1_id: a1.agent_id,
          agent1_name: a1.agent_name,
          agent1_username: a1.username,
          agent2_id: a2.agent_id,
          agent2_name: a2.agent_name,
          agent2_username: a2.username,
          key,
          fight_count: pairHistory.length,
          last_session_id: lastFight?.session_id ?? null,
          last_session_name: lastFight?.session_name ?? null,
          last_outcome: lastFight?.outcome ?? null,
          played_in_prev_session: playedInPrev,
          history_summary: pairHistory.slice(0, 5).map((h) => ({
            session_id: h.session_id,
            session_name: h.session_name,
            outcome: h.outcome,
            finished_at: h.finished_at,
          })),
        });
      }
    }

    return NextResponse.json({
      pairs,
      agents,
      total_agents: agents.length,
      total_pairs_all: pairs.length + (includePrev ? 0 : prevSessionPairs.size),
      total_pairs_preview: pairs.length,
      prev_session: prevSession,
      prev_session_excluded: !includePrev ? prevSessionPairs.size : 0,
    });
  } catch (error) {
    console.error("Preview pairs failed:", error);
    return NextResponse.json({ error: "Không thể tạo preview cặp đấu." }, { status: 500 });
  }
}
