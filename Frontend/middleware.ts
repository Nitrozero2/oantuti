import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "auth_session";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Chỉ áp dụng cho /admin/*
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const secret = getSecret();
  if (!secret) {
    // Cấu hình sai — chặn luôn
    return NextResponse.redirect(new URL("/403", request.url));
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  // Chưa đăng nhập → redirect về login
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const isAdmin = payload.is_admin === true;

    if (!isAdmin) {
      return NextResponse.redirect(new URL("/403", request.url));
    }

    return NextResponse.next();
  } catch {
    // Token hết hạn hoặc không hợp lệ
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/admin/:path*"],
};
