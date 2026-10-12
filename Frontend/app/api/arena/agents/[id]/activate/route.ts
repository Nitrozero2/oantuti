import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { backendFetch } from "@/lib/backend";

export const runtime = "nodejs";

/**
 * POST /api/arena/agents/[id]/activate
 * Admin endpoint: validate agent code via backend, then set status to 'active'.
 * If validation fails, sets status to 'rejected' with the error message.
 *
 * Khi backend offline: trả về 503 với thông báo rõ ràng, trạng thái agent
 * quay lại 'pending' (không bị kẹt ở 'validating').
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  const { id } = await params;
  const agentId = parseInt(id, 10);
  if (isNaN(agentId)) {
    return NextResponse.json({ error: "ID không hợp lệ." }, { status: 400 });
  }

  try {
    // Fetch agent code
    const agentRows = await sql`
      SELECT id, code, status FROM arena_agents WHERE id = ${agentId}
    ` as { id: number; code: string; status: string }[];

    if (agentRows.length === 0) {
      return NextResponse.json({ error: "Agent không tồn tại." }, { status: 404 });
    }

    const agent = agentRows[0];

    // Mark as validating
    await sql`UPDATE arena_agents SET status = 'validating' WHERE id = ${agentId}`;

    // Validate via backend (timeout 20s)
    const validationResult = await backendFetch("/tournament/validate-agent", {
      method: "POST",
      body: JSON.stringify({ code: agent.code }),
      timeoutMs: 20_000,
    });

    if (!validationResult.ok) {
      // Backend offline hoặc lỗi — trả agent về pending, không reject
      await sql`UPDATE arena_agents SET status = 'pending' WHERE id = ${agentId}`;
      return NextResponse.json(
        {
          valid: false,
          error: validationResult.error,
          backend_offline: validationResult.isOffline,
        },
        { status: validationResult.isOffline ? 503 : 502 },
      );
    }

    const data = validationResult.data as { valid: boolean; error?: string };

    if (data.valid) {
      // Deactivate other agents of same user first
      await sql`
        UPDATE arena_agents SET is_active = false
        WHERE user_id = (SELECT user_id FROM arena_agents WHERE id = ${agentId})
          AND id != ${agentId}
      `;
      // Activate this agent
      await sql`
        UPDATE arena_agents
        SET status = 'active', is_active = true, validation_error = NULL
        WHERE id = ${agentId}
      `;
      return NextResponse.json({ ok: true, status: "active" });
    } else {
      // Reject with error
      const errMsg = data.error ?? "Agent không hợp lệ.";
      await sql`
        UPDATE arena_agents
        SET status = 'rejected', is_active = false, validation_error = ${errMsg}
        WHERE id = ${agentId}
      `;
      return NextResponse.json({
        ok: false,
        status: "rejected",
        validation_error: errMsg,
      });
    }
  } catch (error) {
    console.error("Agent activate failed:", error);
    return NextResponse.json({ error: "Lỗi khi kích hoạt agent." }, { status: 500 });
  }
}
