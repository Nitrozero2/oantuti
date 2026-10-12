"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { MatchSummary } from "@/lib/api";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-slate-400/20 text-slate-300",
  running: "bg-emerald-400/20 text-emerald-300",
  finished: "bg-indigo-400/20 text-indigo-300",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ",
  running: "Đang chạy",
  finished: "Hoàn thành",
};

export default function AdminMatchesPage() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BACKEND_URL}/matches/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMatches((data.matches as MatchSummary[]).reverse()); // newest first
    } catch (e) {
      setError("Không thể tải danh sách trận. Đảm bảo backend đang chạy.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await fetch(`${BACKEND_URL}/matches/${id}`, { method: "DELETE" });
      setMatches((prev) => prev.filter((m) => m.match_id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">
            ← Dashboard
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">📋 Danh Sách Trận Đấu</h1>
            <p className="mt-1 text-slate-400">
              Tất cả các trận đấu đang có trong bộ nhớ backend.
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <button
              onClick={load}
              disabled={loading}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium transition hover:bg-white/5 disabled:opacity-60"
            >
              {loading ? "Đang tải..." : "🔄 Làm mới"}
            </button>
            <Link
              href="/admin/match"
              className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              + Tạo trận mới
            </Link>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] shadow-xl overflow-hidden">
          {loading && matches.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
            </div>
          ) : matches.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-4xl mb-4">🎮</p>
              <p className="text-slate-400">Chưa có trận đấu nào.</p>
              <Link
                href="/admin/match"
                className="mt-4 inline-block rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
              >
                Tạo trận đầu tiên
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                    <th className="px-5 py-4 font-medium">Match ID</th>
                    <th className="px-4 py-4 font-medium">Trạng thái</th>
                    <th className="px-4 py-4 text-right font-medium">Số nước</th>
                    <th className="px-4 py-4 font-medium">Kết quả</th>
                    <th className="px-4 py-4 font-medium">Lý do kết thúc</th>
                    <th className="px-4 py-4 font-medium">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {matches.map((m) => (
                    <tr key={m.match_id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <span className="font-mono text-indigo-300">{m.match_id}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[m.status] ?? "bg-slate-400/20 text-slate-300"
                          }`}
                        >
                          {STATUS_LABEL[m.status] ?? m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">
                        {m.move_count}
                      </td>
                      <td className="px-4 py-3">
                        {m.game_over ? (
                          m.winner ? (
                            <span
                              className={`font-semibold ${
                                m.winner === 1 ? "text-blue-300" : "text-rose-300"
                              }`}
                            >
                              P{m.winner} thắng
                            </span>
                          ) : (
                            <span className="text-yellow-300">Hòa</span>
                          )
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[220px] truncate">
                        {m.win_reason || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Link
                            href={`/admin/match?id=${m.match_id}`}
                            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/5 transition"
                          >
                            Xem
                          </Link>
                          <button
                            onClick={() => handleDelete(m.match_id)}
                            disabled={deleting === m.match_id}
                            className="rounded-lg border border-rose-400/20 px-2.5 py-1 text-xs font-medium text-rose-400 hover:bg-rose-400/10 transition disabled:opacity-50"
                          >
                            {deleting === m.match_id ? "..." : "Xóa"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-600">
          {matches.length} trận · Dữ liệu lưu trong bộ nhớ backend (mất khi restart)
        </p>
      </div>
    </main>
  );
}
