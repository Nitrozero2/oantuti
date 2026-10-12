import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
    }
    const { username: rawUsername, password } = body as { username?: unknown; password?: unknown };
    if (typeof rawUsername !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Vui lòng nhập tên đăng nhập và mật khẩu." }, { status: 400 });
    }

    const username = rawUsername.trim();
    if (username.length < 3 || username.length > 32) {
      return NextResponse.json({ error: "Tên đăng nhập phải dài từ 3 đến 32 ký tự." }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json({ error: "Tên đăng nhập chỉ được dùng chữ cái, số và dấu gạch dưới (_)." }, { status: 400 });
    }
    if (password.length < 8 || password.length > 72) {
      return NextResponse.json({ error: "Mật khẩu phải dài từ 8 đến 72 ký tự." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const rows = await sql`
      INSERT INTO users (username, password_hash)
      VALUES (${username}, ${passwordHash})
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Tên đăng nhập này đã được sử dụng." }, { status: 409 });
    }

    const user = rows[0] as { id: number; username: string };
    await createSession({ id: Number(user.id), username: user.username });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Register failed:", error);
    return NextResponse.json({ error: "Không thể tạo tài khoản lúc này." }, { status: 500 });
  }
}
