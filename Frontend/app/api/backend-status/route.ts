import { NextResponse } from "next/server";
import { isBackendOnline } from "@/lib/backend";

export const runtime = "nodejs";
// Không cache — luôn kiểm tra thực tế
export const dynamic = "force-dynamic";

/**
 * GET /api/backend-status
 * Kiểm tra backend (máy cá nhân) có online không.
 * Frontend dùng endpoint này để hiển thị offline banner.
 *
 * Response: { online: boolean }
 */
export async function GET() {
  const online = await isBackendOnline();
  return NextResponse.json(
    { online },
    {
      status: 200,
      headers: {
        // Cache ngắn: 10 giây — tránh spam check nhưng vẫn phản ánh kịp thời
        "Cache-Control": "public, max-age=10, stale-while-revalidate=5",
      },
    },
  );
}
