import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backendFetch } from "@/lib/backend";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  const { code } = body as Record<string, unknown>;
  if (typeof code !== "string" || code.trim().length < 10)
    return NextResponse.json({ error: "Code quá ngắn." }, { status: 400 });

  const result = await backendFetch("/tournament/validate-agent", {
    method: "POST",
    body: JSON.stringify({ code }),
    timeoutMs: 20_000,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        valid: false,
        error: result.error,
        backend_offline: result.isOffline,
      },
      { status: result.isOffline ? 503 : 500 },
    );
  }

  const data = result.data as { valid: boolean; error?: string };
  return NextResponse.json(data);
}
