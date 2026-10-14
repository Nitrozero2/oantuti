"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";

type WorkerInfo = {
  worker_id: string;
  judge0_url: string;
  active_jobs: number;
  max_concurrent: number;
  available_slots: number;
  seconds_ago: number;
};

type WorkerStatus = {
  workers: WorkerInfo[];
  total_workers: number;
  total_active_jobs: number;
  total_available_slots: number;
  queue_depth: number;
};

type RecentMatch = {
  id: number;
  source: "friendly" | "rating";
  status: string;
  outcome: string | null;
  total_moves: number | null;
  is_infra_error: boolean;
  created_at: string;
  finished_at: string | null;
  created_by_username: string | null;
  agent1_name: string;
  agent2_name: string;
  session_name: string | null;
};

type SystemStatus = {
  backend_online: boolean;
  worker_status: WorkerStatus | null;
  recent_matches: RecentMatch[];
  match_stats: { running: number; finished: number; error: number; pending: number };
};

type TestResult = "idle" | "testing" | "online" | "offline";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running:   "border-amber-300 bg-amber-50 text-amber-800",
    finished:  "border-emerald-300 bg-emerald-50 text-emerald-800",
    error:     "border-rose-300 bg-rose-50 text-rose-800",
    pending:   "border-slate-300 bg-slate-50 text-slate-700",
    scheduled: "border-slate-300 bg-slate-50 text-slate-700",
    cancelled: "border-stone-300 bg-stone-50 text-stone-500",
  };
  const label: Record<string, string> = {
    running: "⏳ running", finished: "✅ finished", error: "❌ error",
    pending: "🕐 pending", scheduled: "🕐 scheduled", cancelled: "🚫 cancelled",
  };
  return (
    <span className={`rounded-none border px-2 py-0.5 text-[11px] font-bold ${map[status] ?? "border-slate-300 bg-slate-50 text-slate-700"}`}>
      {label[status] ?? status}
    </span>
  );
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<TestResult>("idle");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/system-status");
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json() as SystemStatus;
      setSysStatus(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    // Auto-refresh mỗi 15s
    const interval = setInterval(() => load(), 15_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleTestBackend() {
    setTestResult("testing");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "backend_url" }),
      });
      const data = await res.json() as { online?: boolean };
      setTestResult(data.online ? "online" : "offline");
    } catch {
      setTestResult("offline");
    }
  }

  const ws = sysStatus?.worker_status;

  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center justify-between border-b border-[#ded8d3] pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Link href="/dashboard" className="hover:text-[#253B80]">Dashboard</Link>
            <span>/</span>
            <Link href="/admin/rating" className="hover:text-[#253B80]">Admin</Link>
            <span>/</span>
            <span className="text-[#1a1e29]">System Status</span>
          </div>
          <span className="rounded-none border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
            Admin Area
          </span>
        </div>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-3xl font-extrabold text-[#1a1e29]">⚙️ System Status</h1>
            <p className="text-sm text-slate-600">Trạng thái worker, queue và trận đấu gần đây.</p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-[#253B80] disabled:opacity-50 transition"
          >
            {refreshing ? "⏳ Đang tải..." : "🔄 Làm mới"}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
          </div>
        ) : (
          <div className="space-y-6">

            {/* ── Backend & Queue Stats ── */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {/* Backend */}
              <div className="rounded-none border border-[#ded8d3] bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Backend</p>
                <p className={`mt-1 text-xl font-extrabold ${sysStatus?.backend_online ? "text-emerald-600" : "text-rose-600"}`}>
                  {sysStatus?.backend_online ? "🟢 Online" : "🔴 Offline"}
                </p>
              </div>
              {/* Workers */}
              <div className="rounded-none border border-[#ded8d3] bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workers Active</p>
                <p className="mt-1 text-2xl font-extrabold text-[#253B80]">{ws?.total_workers ?? "—"}</p>
              </div>
              {/* Queue */}
              <div className="rounded-none border border-[#ded8d3] bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Queue Depth</p>
                <p className={`mt-1 text-2xl font-extrabold ${(ws?.queue_depth ?? 0) > 0 ? "text-amber-600" : "text-slate-700"}`}>
                  {ws?.queue_depth ?? "—"}
                </p>
              </div>
              {/* Jobs running */}
              <div className="rounded-none border border-[#ded8d3] bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Jobs Đang Chạy</p>
                <p className="mt-1 text-2xl font-extrabold text-[#253B80]">{ws?.total_active_jobs ?? "—"}</p>
              </div>
            </div>

            {/* ── Workers List ── */}
            <div className="rounded-none border border-[#ded8d3] bg-white shadow-md">
              <div className="border-b border-[#ded8d3] px-5 py-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#1a1e29]">🖥️ Workers</h2>
                <span className="text-xs text-slate-500">Cập nhật tự động mỗi 15s</span>
              </div>
              {!ws || ws.workers.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-slate-500">
                  Không có worker nào đang online.{" "}
                  <span className="text-xs">Chạy <code className="bg-stone-100 px-1 font-mono text-[#253B80]">python worker.py</code> trên máy có Judge0.</span>
                </div>
              ) : (
                <div className="divide-y divide-[#ded8d3]">
                  {ws.workers.map((w) => (
                    <div key={w.worker_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-sm font-bold text-[#1a1e29]">{w.worker_id}</p>
                        <p className="text-xs text-slate-500">{w.judge0_url}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-600">
                        <span>
                          <span className="font-bold text-[#1a1e29]">{w.active_jobs}</span>/{w.max_concurrent} jobs
                        </span>
                        <span className={`font-bold ${w.available_slots > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                          {w.available_slots} slot trống
                        </span>
                        <span className="text-slate-400">{w.seconds_ago}s trước</span>
                      </div>
                      {/* Mini progress bar */}
                      <div className="w-full sm:w-32 h-1.5 bg-stone-100 rounded-none">
                        <div
                          className="h-1.5 bg-[#253B80] transition-all"
                          style={{ width: `${Math.min(100, (w.active_jobs / Math.max(1, w.max_concurrent)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Match Stats ── */}
            <div className="rounded-none border border-[#ded8d3] bg-white shadow-md">
              <div className="border-b border-[#ded8d3] px-5 py-3">
                <h2 className="text-sm font-bold text-[#1a1e29]">🎮 Trận đấu (Friendly + TrueSkill)</h2>
              </div>
              <div className="grid grid-cols-4 divide-x divide-[#ded8d3]">
                {(["running", "finished", "error", "pending"] as const).map((s) => (
                  <div key={s} className="p-4 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{s}</p>
                    <p className={`mt-1 text-xl font-extrabold ${
                      s === "running" ? "text-amber-600" :
                      s === "finished" ? "text-emerald-600" :
                      s === "error" ? "text-rose-600" : "text-slate-700"
                    }`}>
                      {sysStatus?.match_stats[s] ?? 0}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Recent Matches ── */}
            <div className="rounded-none border border-[#ded8d3] bg-white shadow-md">
              <div className="border-b border-[#ded8d3] px-5 py-3">
                <h2 className="text-sm font-bold text-[#1a1e29]">📋 Trận gần đây (20 trận mới nhất)</h2>
              </div>
              {!sysStatus?.recent_matches.length ? (
                <div className="px-5 py-8 text-center text-sm text-slate-500">Chưa có trận nào.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#ded8d3] text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-2">ID</th>
                        <th className="px-4 py-2">Loại</th>
                        <th className="px-4 py-2">Tạo bởi</th>
                        <th className="px-4 py-2">Agent 1 vs 2</th>
                        <th className="px-4 py-2">Trạng thái</th>
                        <th className="px-4 py-2">Kết quả</th>
                        <th className="px-4 py-2">Nước</th>
                        <th className="px-4 py-2">Thời gian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ded8d3]">
                      {sysStatus.recent_matches.map((m, i) => (
                        <tr key={`${m.source}-${m.id}-${i}`} className="hover:bg-stone-50 transition">
                          <td className="px-4 py-2 font-mono text-slate-500">#{m.id}</td>
                          <td className="px-4 py-2">
                            {m.source === "rating" ? (
                              <span className="rounded-none border border-purple-300 bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">
                                🧠 TrueSkill
                              </span>
                            ) : (
                              <span className="rounded-none border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                                ⚔️ friendly
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-slate-600">@{m.created_by_username ?? "?"}</td>
                          <td className="px-4 py-2 font-medium">
                            <span className="text-[#253B80]">{m.agent1_name}</span>
                            <span className="text-slate-400 mx-1">vs</span>
                            <span className="text-rose-600">{m.agent2_name}</span>
                          </td>
                          <td className="px-4 py-2"><StatusBadge status={m.status} /></td>
                          <td className="px-4 py-2 text-slate-600">
                            {m.status === "finished"
                              ? (m.outcome === "agent1" ? "🏆 A1 thắng" : m.outcome === "agent2" ? "🏆 A2 thắng" : "🤝 Hòa")
                              : m.is_infra_error ? "⚠️ lỗi hạ tầng" : "—"}
                          </td>
                          <td className="px-4 py-2 text-slate-600">{m.total_moves ?? "—"}</td>
                          <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                            {new Date(m.created_at).toLocaleString("vi-VN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Backend URL Info ── */}
            <div className="rounded-none border border-[#ded8d3] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-bold text-[#1a1e29]">🌐 Backend URL</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Đọc từ biến môi trường <code className="bg-stone-100 px-1 font-mono text-[#253B80]">BACKEND_URL</code> trên Vercel.
                    Để thay đổi: cập nhật env var → redeploy.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {testResult !== "idle" && (
                    <span className={`rounded-none border px-3 py-1 text-xs font-bold ${
                      testResult === "testing" ? "border-amber-300 bg-amber-50 text-amber-800" :
                      testResult === "online"  ? "border-emerald-300 bg-emerald-50 text-emerald-800" :
                                                 "border-rose-300 bg-rose-50 text-rose-800"
                    }`}>
                      {testResult === "testing" ? "⏳ Testing..." : testResult === "online" ? "🟢 Online" : "🔴 Offline"}
                    </span>
                  )}
                  <button
                    onClick={handleTestBackend}
                    disabled={testResult === "testing"}
                    className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-[#253B80] disabled:opacity-50 transition"
                  >
                    🔌 Test kết nối
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
