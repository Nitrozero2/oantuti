import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backendFetch } from "@/lib/backend";

export const runtime = "nodejs";

/**
 * GET /api/tournament/status
 *
 * Proxy server-side tới Python backend /tournament/status.
 * Tránh browser gọi thẳng localhost:8000 (bị CORS/loopback block trên Vercel).
 */
export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  const res = await backendFetch("/tournament/status", {
    method: "GET",
    timeoutMs: 5_000,
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, backend_offline: res.isOffline },
      { status: res.isOffline ? 503 : res.status },
    );
  }

  return NextResponse.json(res.data);
}
