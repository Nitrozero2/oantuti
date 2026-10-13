"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={logout}
      disabled={busy}
      className={
        className ||
        "inline-flex items-center gap-2 rounded-none border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-300 disabled:opacity-60 cursor-pointer"
      }
      title="Đăng xuất khỏi hệ thống"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
        />
      </svg>
      <span>{busy ? "Đang xử lý..." : "Đăng xuất"}</span>
    </button>
  );
}
