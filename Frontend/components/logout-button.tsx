"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
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
    <button onClick={logout} disabled={busy} className="mt-7 rounded-xl border border-white/15 px-5 py-3 font-semibold hover:bg-white/5 disabled:opacity-60">
      {busy ? "Đang đăng xuất..." : "Đăng xuất"}
    </button>
  );
}
