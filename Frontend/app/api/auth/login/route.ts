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
    const { username: rawUsername, password } = body as {
      username?: unknown;
      password?: unknown;
    };
    if (
      typeof rawUsername !== "string" ||
      typeof password !== "string" ||
      password.length > 72
    ) {
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu không đúng." },
        { status: 400 },
      );
    }

    const username = rawUsername.trim();
    const rows = await sql`
      SELECT id, username, password_hash, is_admin
      FROM users
      WHERE username = ${username}
      LIMIT 1
    `;

    const user = rows[0] as
      | { id: number; username: string; password_hash: string; is_admin: boolean }
      | undefined;

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return NextResponse.json(
        { error: "Tên đăng nhập hoặc mật khẩu không đúng." },
        { status: 401 },
      );
    }

    await createSession({
      id: Number(user.id),
      username: user.username,
      is_admin: user.is_admin,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Login failed:", error);
    return NextResponse.json({ error: "Không thể đăng nhập lúc này." }, { status: 500 });
  }
}
