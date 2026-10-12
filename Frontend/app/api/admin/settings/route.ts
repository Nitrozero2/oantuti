import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { invalidateBackendUrlCache, isBackendOnline } from "@/lib/backend";

export const runtime = "nodejs";

/** GET /api/admin/settings — lấy tất cả settings */
export async function GET() {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  try {
    const rows = await sql`
      SELECT key, value, updated_at,
             (SELECT username FROM users WHERE id = app_settings.updated_by) AS updated_by_username
      FROM app_settings
      ORDER BY key
    `;
    return NextResponse.json({ settings: rows });
  } catch {
    return NextResponse.json({ error: "Không thể tải settings." }, { status: 500 });
  }
}

/** POST /api/admin/settings — cập nhật 1 setting */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const { key, value } = body as Record<string, unknown>;

  if (typeof key !== "string" || key.trim().length === 0)
    return NextResponse.json({ error: "Thiếu key." }, { status: 400 });
  if (typeof value !== "string")
    return NextResponse.json({ error: "Thiếu value." }, { status: 400 });

  const k = key.trim();
  const v = value.trim();

  // Whitelist các key được phép sửa
  const ALLOWED_KEYS = ["backend_url"];
  if (!ALLOWED_KEYS.includes(k)) {
    return NextResponse.json({ error: `Key '${k}' không được phép sửa.` }, { status: 400 });
  }

  // Validate URL nếu là backend_url
  if (k === "backend_url" && v !== "") {
    try {
      const url = new URL(v);
      if (!["http:", "https:"].includes(url.protocol)) {
        return NextResponse.json({ error: "URL phải bắt đầu bằng http:// hoặc https://" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL không hợp lệ." }, { status: 400 });
    }
  }

  try {
    await sql`
      INSERT INTO app_settings (key, value, updated_at, updated_by)
      VALUES (${k}, ${v}, NOW(), ${session.id})
      ON CONFLICT (key) DO UPDATE
        SET value = ${v}, updated_at = NOW(), updated_by = ${session.id}
    `;

    // Xóa cache ngay để mọi request tiếp theo dùng URL mới
    invalidateBackendUrlCache();

    // Nếu là backend_url, test kết nối luôn
    if (k === "backend_url" && v !== "") {
      const online = await isBackendOnline();
      return NextResponse.json({ ok: true, online });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Không thể lưu setting." }, { status: 500 });
  }
}
