import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { dispatchNextRatingTask } from "@/lib/rating-scheduler";

export const runtime = "nodejs";

// POST: nộp agent mới
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });

  const { agent_name, description, code } = body as Record<string, unknown>;

  if (typeof agent_name !== "string" || agent_name.trim().length === 0)
    return NextResponse.json({ error: "Vui lòng đặt tên agent." }, { status: 400 });
  if (agent_name.trim().length > 100)
    return NextResponse.json({ error: "Tên tối đa 100 ký tự." }, { status: 400 });
  if (typeof code !== "string" || code.trim().length === 0)
    return NextResponse.json({ error: "Vui lòng nhập code agent." }, { status: 400 });
  if (code.length > 65536)
    return NextResponse.json({ error: "Code quá dài (tối đa 65536 ký tự)." }, { status: 400 });
  if (!code.includes("def agent("))
    return NextResponse.json({ error: "Code phải có hàm `def agent(observation, configuration):`." }, { status: 400 });

  const desc = typeof description === "string" ? description.trim().slice(0, 500) : "";

  try {
    // Lấy version hiện tại của user
    const versionRows = await sql`
      SELECT COALESCE(MAX(version), 0) AS max_version
      FROM arena_agents WHERE user_id = ${session.id}
    `;
    const nextVersion = (versionRows[0] as { max_version: number }).max_version + 1;

    // Each approved version remains an independently rated agent. A new submission
    // validates itself in the worker before it may enter the rating queue.
    const rows = await sql`
      INSERT INTO arena_agents (user_id, agent_name, description, code, version, status, is_active)
      VALUES (${session.id}, ${agent_name.trim()}, ${desc}, ${code}, ${nextVersion}, 'validating', false)
      RETURNING id, agent_name, version, submitted_at
    `;
    const agent = rows[0] as { id: number; agent_name: string; version: number; submitted_at: string };
    await sql`
      INSERT INTO rated_matches (kind, agent1_id, agent2_id)
      VALUES ('validation', ${agent.id}, ${agent.id})
    `;
    // The task remains safely scheduled if the worker/backend is temporarily down.
    await dispatchNextRatingTask().catch((error) => console.error("Could not dispatch validation:", error));
    return NextResponse.json({
      ok: true, agent_id: agent.id, agent_name: agent.agent_name, version: agent.version,
      submitted_at: agent.submitted_at, status: "validating",
    });
  } catch (error) {
    console.error("Arena submit failed:", error);
    return NextResponse.json({ error: "Không thể lưu agent." }, { status: 500 });
  }
}

// GET: danh sách agent của user hiện tại
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  try {
    const rows = await sql`
      SELECT id, agent_name, description, code, version, status, validation_error,
             is_active, wins, losses, draws, error_matches, rating AS elo, submitted_at
      FROM arena_agents
      WHERE user_id = ${session.id}
      ORDER BY version DESC
      LIMIT 20
    `;
    return NextResponse.json({ agents: rows });
  } catch (error) {
    console.error("Fetch agents failed:", error);
    return NextResponse.json({ error: "Không thể tải danh sách agent." }, { status: 500 });
  }
}
