"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "@/components/logout-button";
import logoImg from "@/source/images/logo.png";

type UserSession = {
  id: number;
  username: string;
  is_admin: boolean;
};

export default function Navbar({ initialUser }: { initialUser?: UserSession | null }) {
  const [user, setUser] = useState<UserSession | null>(initialUser ?? null);
  const pathname = usePathname();

  useEffect(() => {
    setUser(initialUser ?? null);
    let controller = new AbortController();
    const load = () => {
      controller.abort(); controller = new AbortController();
      const active = controller;
      fetch("/api/auth/me", { signal: active.signal, cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!active.signal.aborted) setUser(data?.authenticated && data.user ? data.user : null);
        })
        .catch(() => {});
    };
    const authChanged = () => { setUser(null); load(); };
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    load();
    window.addEventListener('arena:auth-changed', authChanged);
    window.addEventListener('pageshow', load);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      window.removeEventListener('arena:auth-changed', authChanged);
      window.removeEventListener('pageshow', load);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [initialUser, pathname]);

  const navLinks = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Bảng Xếp Hạng", href: "/arena/leaderboard" },
    { label: "Chung kết", href: "/finals" },
    { label: "Nộp Agent", href: "/arena/submit" },
    { label: "Thách đấu", href: "/arena/friendly" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#ded8d3] bg-[#F5F0ED]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {/* Nhóm bên trái: Logo trường + OTTv2 Arena + Menu links */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-6">
          {/* Logo trường */}
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="relative h-10 w-10 select-none pointer-events-none sm:h-11 sm:w-11">
              <Image
                src={logoImg}
                alt="Logo trường"
                priority
                className="h-full w-full object-contain"
              />
            </div>
            <span className="text-lg font-extrabold tracking-tight text-[#253B80] sm:text-xl">
              OTTv2 Arena
            </span>
          </Link>

          <div className="hidden h-5 w-px bg-[#ded8d3] sm:block" />

          {/* Quick nav links với khung thẳng */}
          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => {
              const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-none border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-[#253B80] bg-[#253B80] text-white"
                      : "border-transparent text-slate-700 hover:border-[#ded8d3] hover:bg-white/80 hover:text-[#253B80]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Nhóm bên phải: Thông tin User, ID và Đăng xuất */}
        <div className="flex items-center gap-3 sm:gap-4">
          {user && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[#1a1e29]">{user.username}</span>
              <span className="rounded-none border border-[#ded8d3] bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                ID: {user.id}
              </span>
              {user.is_admin && (
                <span className="rounded-none border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                  Admin
                </span>
              )}
            </div>
          )}

          <div className="hidden h-5 w-px bg-[#ded8d3] sm:block" />

          <Link href="/team" className="border border-[#ded8d3] bg-white px-3 py-1.5 text-xs font-semibold text-[#253B80]">Team</Link>
          {user ? <LogoutButton className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-400" />
            : <div className="flex flex-wrap gap-2"><Link href="/login" className="border border-[#ded8d3] bg-white px-3 py-1.5 text-xs font-semibold text-[#253B80]">Đăng nhập</Link><Link href="/register" className="border border-[#253B80] bg-[#253B80] px-3 py-1.5 text-xs font-semibold text-white">Đăng ký</Link></div>}
        </div>
      </div>
    </header>
  );
}
