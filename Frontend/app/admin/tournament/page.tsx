"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

type Session = {
  id: number;
  name: string;
  status: string;
  config: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  total_matches: number;
  scheduled_matches: number;
  running_matches: number;
  finished_matches: number;
  error_matches: number;
};

type WorkerStatus = {
  status: string;
  session_id: number | null;
  queue_depth: number;
  active_count: number;
  completed: number;
  errors: number;
  active_match_ids: string[];
};

const STATUS_BADGE: Record<string, string> = {
  idle: "bg-slate-100 text-slate-700 border-slate-300",
  running: "bg-emerald-50 text-emerald-700 border-emerald-300",
  paused: "bg-amber-50 text-amber-700 border-amber-300",
  stopped: "bg-rose-50 text-rose-700 border-rose-300",
  completed: "bg-[#253B80]/10 text-[#253B80] border-[#253B80]/30",
};

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function AdminTournamentPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);

  // New session form
  const [newName, setNewName] = useState("");
  const [maxParallel, setMaxParallel] = useState(3);
  const [maxMoves, setMaxMoves] = useState(300);
  const [newAgentPolicy, setNewAgentPolicy] = useState("exclude");
  const [allowRematch, setAllowRematch] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sessRes, workerRes] = await Promise.all([
        fetch("/api/tournament/sessions"),
        fetch(`${BACKEND_URL}/tournament/status`).catch(() => null),
      ]);
      if (sessRes.ok) {
        const d = (await sessRes.json()) as { sessions?: Session[] };
        setSessions(d.sessions ?? []);
      }
      if (workerRes?.ok) {
        const w = (await workerRes.json()) as WorkerStatus;
        setWorker(w);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh when running
  const latestSession = sessions[0];
  useEffect(() => {
    if (latestSession?.status === "running" || worker?.status === "running") {
      const t = setInterval(load, 5000);
      return () => clearInterval(t);
    }
  }, [latestSession?.status, worker?.status, load]);

  async function control(sessionId: number, action: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tournament/sessions/${sessionId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Lỗi.");
        return;
      }
      await load();
    } catch {
      setError("Không thể kết nối.");
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tournament/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName || undefined,
          config: {
            max_parallel_matches: maxParallel,
            max_moves: maxMoves,
            new_agent_policy: newAgentPolicy,
            allow_rematch: allowRematch,
          },
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        session_id?: number;
        total_pairs?: number;
        total_agents?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Lỗi tạo session.");
        return;
      }
      setShowNewForm(false);
      setNewName("");
      await load();
      setError(`✅ Đã tạo session #${data.session_id}: ${data.total_agents} agents, ${data.total_pairs} cặp đấu.`);
    } catch {
      setError("Không thể tạo session.");
    } finally {
      setBusy(false);
    }
  }

  const latest = sessions[0];
  const progressPct =
    latest && latest.total_matches > 0
      ? Math.round((latest.finished_matches / latest.total_matches) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between border-b border-[#ded8d3] pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Link href="/dashboard" className="hover:text-[#253B80]">Dashboard</Link>
            <span>/</span>
            <span className="text-[#1a1e29]">Admin Tournament</span>
          </div>
          <span className="rounded-none border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
            Admin Area
          </span>
        </div>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-[#1a1e29]">🎮 Tournament Control</h1>
            <p className="mt-1 text-sm text-slate-600">Quản lý hệ thống ghép trận đấu tự động OTTv2 Arena.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-[#253B80] disabled:opacity-50"
          >
            🔄 Làm mới
          </button>
        </div>

        {error && (
          <div
            className={`mb-6 rounded-none border px-4 py-3 text-sm font-bold ${
              error.startsWith("✅")
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-rose-300 bg-rose-50 text-rose-800"
            }`}
          >
            {error}
          </div>
        )}

        {/* Worker status: Khung thẳng */}
        {worker && (
          <div className="mb-6 rounded-none border border-[#ded8d3] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-[#1a1e29]">Worker Trạng thái:</span>
                <span
                  className={`rounded-none border px-2.5 py-0.5 text-xs font-bold ${
                    STATUS_BADGE[worker.status] ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {worker.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-4 font-mono text-xs text-slate-600">
                <span>Hàng đợi: <strong className="text-[#1a1e29]">{worker.queue_depth}</strong></span>
                <span>Đang chạy: <strong className="text-emerald-700">{worker.active_count}</strong></span>
                <span>Hoàn tất: <strong className="text-[#253B80]">{worker.completed}</strong></span>
                <span>Lỗi: <strong className="text-rose-700">{worker.errors}</strong></span>
              </div>
            </div>
            {worker.active_match_ids.length > 0 && (
              <p className="mt-2 font-mono text-xs text-slate-500">
                Trận đang chạy ID: {worker.active_match_ids.join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Latest session: Khung thẳng */}
        {latest && (
          <div className="mb-6 rounded-none border border-[#ded8d3] bg-white p-6 shadow-md">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[#1a1e29]">{latest.name}</h2>
                  <span
                    className={`rounded-none border px-2.5 py-0.5 text-xs font-bold ${
                      STATUS_BADGE[latest.status] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {latest.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Session #{latest.id} · Tạo {new Date(latest.created_at).toLocaleString("vi-VN")}
                  {latest.completed_at &&
                    ` · Xong ${new Date(latest.completed_at).toLocaleString("vi-VN")}`}
                </p>
              </div>

              {/* Control buttons */}
              <div className="flex flex-wrap gap-2">
                {["idle", "stopped"].includes(latest.status) && (
                  <button
                    onClick={() => control(latest.id, "start")}
                    disabled={busy}
                    className="cursor-pointer rounded-none bg-emerald-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                  >
                    ▶ Bắt đầu (Start)
                  </button>
                )}
                {latest.status === "running" && (
                  <button
                    onClick={() => control(latest.id, "pause")}
                    disabled={busy}
                    className="cursor-pointer rounded-none bg-amber-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-50"
                  >
                    ⏸ Tạm dừng (Pause)
                  </button>
                )}
                {latest.status === "paused" && (
                  <button
                    onClick={() => control(latest.id, "resume")}
                    disabled={busy}
                    className="cursor-pointer rounded-none bg-emerald-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                  >
                    ▶ Tiếp tục (Resume)
                  </button>
                )}
                {["running", "paused"].includes(latest.status) && (
                  <button
                    onClick={() => control(latest.id, "stop")}
                    disabled={busy}
                    className="cursor-pointer rounded-none bg-rose-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-800 disabled:opacity-50"
                  >
                    ⏹ Dừng hẳn (Stop)
                  </button>
                )}
              </div>
            </div>

            {/* Progress */}
            <div className="mt-5 border-t border-[#ded8d3] pt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Đã hoàn thành: <strong className="text-[#1a1e29]">{latest.finished_matches}</strong> / {latest.total_matches} trận
                </span>
                <span className="flex gap-3">
                  {latest.scheduled_matches > 0 && <span>⏳ {latest.scheduled_matches} chờ</span>}
                  {latest.running_matches > 0 && <span className="font-bold text-emerald-700">⚡ {latest.running_matches} chạy</span>}
                  {latest.error_matches > 0 && <span className="font-bold text-rose-700">⚠️ {latest.error_matches} lỗi</span>}
                </span>
              </div>
              <div className="h-2 w-full rounded-none bg-stone-200 overflow-hidden border border-[#ded8d3]">
                <div
                  className="h-full bg-[#253B80] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-1 text-right font-mono text-xs font-bold text-[#253B80]">{progressPct}%</p>
            </div>

            {/* Config */}
            <div className="mt-3 flex flex-wrap gap-4 font-mono text-xs text-slate-500">
              <span>⚡ Parallel: {((latest.config as Record<string, unknown>).max_parallel_matches as number) ?? "?"}</span>
              <span>🎯 MaxMoves: {((latest.config as Record<string, unknown>).max_moves as number) ?? "?"}</span>
              <span>📋 Policy: {String((latest.config as Record<string, unknown>).new_agent_policy ?? "exclude")}</span>
            </div>
          </div>
        )}

        {/* New session button */}
        <div className="mb-6">
          <button
            onClick={() => setShowNewForm((v) => !v)}
            className="cursor-pointer rounded-none bg-[#253B80] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66]"
          >
            {showNewForm ? "✕ Đóng form" : "+ Tạo Mùa Giải Mới (Session)"}
          </button>
        </div>

        {showNewForm && (
          <div className="mb-8 rounded-none border border-[#ded8d3] bg-white p-6 shadow-md">
            <h3 className="mb-4 text-base font-bold text-[#253B80]">Cấu hình Session mới</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-bold text-[#1a1e29]">
                Tên session
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={`Mùa giải ${new Date().toLocaleDateString("vi-VN")}`}
                  className="rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-sm text-[#1a1e29] outline-none focus:border-[#253B80]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[#1a1e29]">
                Số trận chạy song song (Max parallel 1–10)
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxParallel}
                  onChange={(e) => setMaxParallel(Number(e.target.value))}
                  className="rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-sm text-[#1a1e29] outline-none focus:border-[#253B80]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[#1a1e29]">
                Số nước tối đa mỗi trận (Max moves)
                <input
                  type="number"
                  min={50}
                  max={1000}
                  value={maxMoves}
                  onChange={(e) => setMaxMoves(Number(e.target.value))}
                  className="rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-sm text-[#1a1e29] outline-none focus:border-[#253B80]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[#1a1e29]">
                Chính sách khi có agent mới
                <select
                  value={newAgentPolicy}
                  onChange={(e) => setNewAgentPolicy(e.target.value)}
                  className="rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-sm text-[#1a1e29] outline-none focus:border-[#253B80]"
                >
                  <option value="exclude">Exclude (không thêm vào giải đang chạy)</option>
                  <option value="include">Include (tự động ghép thêm vào queue)</option>
                </select>
              </label>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={allowRematch}
                onChange={(e) => setAllowRematch(e.target.checked)}
                className="accent-[#253B80]"
              />
              Cho phép đấu lại (Allow rematch)
            </label>
            <button
              onClick={createSession}
              disabled={busy}
              className="mt-4 cursor-pointer rounded-none bg-[#253B80] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66] disabled:opacity-50"
            >
              {busy ? "Đang tạo..." : "Xác nhận tạo Session"}
            </button>
          </div>
        )}

        {/* All sessions: Khung thẳng */}
        <div>
          <h2 className="mb-3 text-base font-bold text-[#1a1e29]">📋 Danh sách các Sessions</h2>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có session nào. Nhấn nút tạo ở trên.</p>
          ) : (
            <div className="space-y-2">
              {sessions.slice(1).map((s) => {
                const pct = s.total_matches > 0 ? Math.round((s.finished_matches / s.total_matches) * 100) : 0;
                return (
                  <div key={s.id} className="rounded-none border border-[#ded8d3] bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#1a1e29]">{s.name}</span>
                        <span
                          className={`rounded-none border px-2 py-0.5 text-xs font-bold ${
                            STATUS_BADGE[s.status] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-xs text-slate-600">
                        <span>
                          {s.finished_matches}/{s.total_matches}
                        </span>
                        <div className="h-1.5 w-20 rounded-none bg-stone-200 overflow-hidden border border-[#ded8d3]">
                          <div className="h-full bg-[#253B80]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Tạo lúc {new Date(s.created_at).toLocaleString("vi-VN")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
