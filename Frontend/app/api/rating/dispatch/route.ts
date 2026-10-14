import { NextResponse } from "next/server";
import { dispatchNextRatingTask } from "@/lib/rating-scheduler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.RATING_DISPATCH_SECRET;
  if (!secret || request.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 401 });
  }
  try {
    return NextResponse.json(await dispatchNextRatingTask());
  } catch (error) {
    console.error("Rating dispatcher failed:", error);
    return NextResponse.json({ error: "Không thể tạo trận rating." }, { status: 500 });
  }
}
