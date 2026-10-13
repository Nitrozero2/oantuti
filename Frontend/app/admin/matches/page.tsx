"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import type { MatchSummary } from "@/lib/api";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-300",
  running: "bg-amber-50 text-amber-700 border-amber-300",
  finished: "bg-emerald-50 text-emerald-700 border-emerald-300",
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
      setMatches((data.matches as MatchSummary[]).reverse());
    } catch {
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
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between border-b border-[#ded8d3] pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Link href="/dashboard" className="hover:text-[#253B80]">Dashboard</Link>
            <span>/</span>
            <Link href="/admin/tournament" className="hover:text-[#253B80]">Tournament</Link>
            <span>/</span>
            <span className="text-[#1a1e29]">Quản lý trận</span>
          </div>
          <span className="rounded-none border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
            Admin Area
          </span>
        </div>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-[#1a1e29]">📋 Quản Lý Trận Đấu</h1>
            <p className="mt-1 text-sm text-slate-600">
              Danh sách các trận đấu đang có trong bộ nhớ (in-memory) của backend FastAPI.
            </p>
          </div>
          <div className="flex shrink-0 gap-2.5">
            <button
              onClick={load}
              disabled={loading}
              className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-[#253B80] disabled:opacity-50"
            >
              {loading ? "Đang tải..." : "🔄 Làm mới"}
            </button>
            <Link
              href="/admin/match"
              className="rounded-none bg-[#253B80] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#1d2e66]"
            >
              + Tạo trận mới
            </Link>
          </div>
        </div>

        {error && (
          <p className="mb-6 rounded-none border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-none border border-[#ded8d3] bg-white shadow-md">
          {loading && matches.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
            </div>
          ) : matches.length === 0 ? (
            <div className="py-16 text-center">
              <p className="mb-3 text-4xl">🎮</p>
              <p className="text-sm text-slate-500">Chưa có trận đấu nào trong backend.</p>
              <Link
                href="/admin/match"
                className="mt-4 inline-block rounded-none bg-[#253B80] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66]"
              >
                Tạo trận đầu tiên
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#ded8d3] bg-stone-50 text-left text-xs font-bold text-slate-600">
                    <th className="px-5 py-3.5">Match ID</th>
                    <th className="px-4 py-3.5">Trạng thái</th>
                    <th className="px-4 py-3.5 text-right">Số nước</th>
                    <th className="px-4 py-3.5">Kết quả</th>
                    <th className="px-4 py-3.5">Lý do kết thúc</th>
                    <th className="px-4 py-3.5">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ded8d3]">
                  {matches.map((m) => (
                    <tr key={m.match_id} className="hover:bg-stone-50 transition">
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs font-bold text-[#253B80]">{m.match_id}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-none border px-2 py-0.5 text-xs font-bold ${
                            STATUS_BADGE[m.status] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {STATUS_LABEL[m.status] ?? m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold text-slate-700">
                        {m.move_count}
                      </td>
                      <td className="px-4 py-3">
                        {m.game_over ? (
                          m.winner ? (
                            <span
                              className={`text-xs font-bold ${
                                m.winner === 1 ? "text-[#253B80]" : "text-rose-700"
                              }`}
                            >
                              P{m.winner} thắng
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-slate-600">Hòa</span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-xs text-slate-500">
                        {m.win_reason || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Link
                            href={`/admin/match?id=${m.match_id}`}
                            className="rounded-none border border-[#ded8d3] bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition hover:border-[#253B80]"
                          >
                            Xem
                          </Link>
                          <button
                            onClick={() => handleDelete(m.match_id)}
                            disabled={deleting === m.match_id}
                            className="cursor-pointer rounded-none border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
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

        <p className="mt-6 text-center text-xs text-slate-500">
          Tổng số {matches.length} trận · Dữ liệu lưu trong RAM của backend FastAPI
        </p>
      </main>
    </div>
  );
}
