import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { backendFetch } from "@/lib/backend";

export const runtime = "nodejs";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.is_admin) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });

  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) return NextResponse.json({ error: "ID không hợp lệ." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  const { action } = body as Record<string, unknown>;
  if (typeof action !== "string") return NextResponse.json({ error: "Thiếu action." }, { status: 400 });

  const tsRows = await sql`SELECT id, status, config FROM tournament_sessions WHERE id = ${sessionId}`;
  if (tsRows.length === 0) return NextResponse.json({ error: "Session không tồn tại." }, { status: 404 });
  const ts = tsRows[0] as { id: number; status: string; config: Record<string, unknown> };

  try {
    if (action === "start") {
      if (!["idle", "stopped"].includes(ts.status))
        return NextResponse.json({ error: `Không thể start từ trạng thái '${ts.status}'.` }, { status: 400 });

      const matchRows = await sql`
        SELECT m.id AS match_id, m.agent1_id, m.agent2_id,
               a1.code AS agent1_code, a2.code AS agent2_code
        FROM tournament_matches m
        JOIN arena_agents a1 ON a1.id = m.agent1_id
        JOIN arena_agents a2 ON a2.id = m.agent2_id
        WHERE m.session_id = ${sessionId} AND m.status = 'scheduled'
      ` as { match_id: number; agent1_id: number; agent2_id: number; agent1_code: string; agent2_code: string }[];

      if (matchRows.length === 0)
        return NextResponse.json({ error: "Không còn trận nào cần chạy." }, { status: 400 });

      const cfg = ts.config as Record<string, number>;
      const pairs = matchRows.map(m => ({
        match_id: m.match_id, agent1_id: m.agent1_id, agent1_code: m.agent1_code,
        agent2_id: m.agent2_id, agent2_code: m.agent2_code,
      }));

      const backendRes = await backendFetch(`/tournament/sessions/${sessionId}/start`, {
        method: "POST",
        body: JSON.stringify({
          pairs,
          config: { max_parallel: cfg.max_parallel_matches ?? 3, max_moves: cfg.max_moves ?? 300 },
          callback_url: FRONTEND_URL,
        }),
        timeoutMs: 10_000,
      });

      if (!backendRes.ok) {
        return NextResponse.json(
          { error: backendRes.error, backend_offline: backendRes.isOffline },
          { status: backendRes.isOffline ? 503 : 500 },
        );
      }

      await sql`UPDATE tournament_sessions SET status = 'running', started_at = NOW() WHERE id = ${sessionId}`;
      return NextResponse.json({ ok: true, status: "running", queued: pairs.length });

    } else if (action === "pause") {
      if (ts.status !== "running")
        return NextResponse.json({ error: "Session không đang chạy." }, { status: 400 });

      const backendRes = await backendFetch(`/tournament/sessions/${sessionId}/pause`, {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: 10_000,
      });

      if (!backendRes.ok) {
        return NextResponse.json(
          { error: backendRes.error, backend_offline: backendRes.isOffline },
          { status: backendRes.isOffline ? 503 : 500 },
        );
      }

      await sql`UPDATE tournament_sessions SET status = 'paused', paused_at = NOW() WHERE id = ${sessionId}`;
      return NextResponse.json({ ok: true, status: "paused" });

    } else if (action === "resume") {
      if (ts.status !== "paused")
        return NextResponse.json({ error: "Session không đang paused." }, { status: 400 });

      const remaining = await sql`
        SELECT m.id AS match_id, m.agent1_id, m.agent2_id,
               a1.code AS agent1_code, a2.code AS agent2_code
        FROM tournament_matches m
        JOIN arena_agents a1 ON a1.id = m.agent1_id
        JOIN arena_agents a2 ON a2.id = m.agent2_id
        WHERE m.session_id = ${sessionId} AND m.status IN ('scheduled', 'error')
      ` as { match_id: number; agent1_id: number; agent2_id: number; agent1_code: string; agent2_code: string }[];

      const backendRes = await backendFetch(`/tournament/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          new_pairs: remaining.map(m => ({
            match_id: m.match_id, agent1_id: m.agent1_id, agent1_code: m.agent1_code,
            agent2_id: m.agent2_id, agent2_code: m.agent2_code,
          })),
          callback_url: FRONTEND_URL,
        }),
        timeoutMs: 10_000,
      });

      if (!backendRes.ok) {
        return NextResponse.json(
          { error: backendRes.error, backend_offline: backendRes.isOffline },
          { status: backendRes.isOffline ? 503 : 500 },
        );
      }

      await sql`UPDATE tournament_sessions SET status = 'running', resumed_at = NOW() WHERE id = ${sessionId}`;
      return NextResponse.json({ ok: true, status: "running", resumed_pairs: remaining.length });

    } else if (action === "stop") {
      // Stop: cố gắng báo backend, nhưng nếu offline thì vẫn cập nhật DB
      const backendRes = await backendFetch(`/tournament/sessions/${sessionId}/stop`, {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: 8_000,
      });

      let wasOffline = false;
      if (!backendRes.ok) {
        // Type narrowed to { ok: false; isOffline: boolean; error: string; ... }
        wasOffline = backendRes.isOffline;
        if (!wasOffline) {
          // Lỗi backend thực sự (không phải offline) → báo lỗi
          return NextResponse.json({ error: backendRes.error }, { status: 500 });
        }
      }

      // Nếu backend offline hoặc online & stop thành công, cập nhật DB
      await sql`UPDATE tournament_sessions SET status = 'stopped', stopped_at = NOW() WHERE id = ${sessionId}`;
      return NextResponse.json({
        ok: true,
        status: "stopped",
        note: wasOffline
          ? "Backend offline — trạng thái đã được cập nhật trong DB nhưng worker có thể vẫn đang chạy."
          : undefined,
      });

    } else {
      return NextResponse.json({ error: `Action '${action}' không hợp lệ.` }, { status: 400 });
    }
  } catch (error) {
    console.error("Tournament control failed:", error);
    return NextResponse.json({ error: "Lỗi kết nối backend." }, { status: 500 });
  }
}
