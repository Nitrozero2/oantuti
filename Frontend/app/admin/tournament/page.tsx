"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Session = {
  id: number; name: string; status: string; config: Record<string, unknown>;
  created_at: string; started_at: string | null; completed_at: string | null;
  total_matches: number; scheduled_matches: number; running_matches: number;
  finished_matches: number; error_matches: number;
};

type WorkerStatus = {
  status: string; session_id: number | null; queue_depth: number;
  active_count: number; completed: number; errors: number; active_match_ids: string[];
};

const STATUS_BADGE: Record<string, string> = {
  idle: "bg-slate-400/20 text-slate-300",
  running: "bg-emerald-400/20 text-emerald-300",
  paused: "bg-yellow-400/20 text-yellow-300",
  stopped: "bg-rose-400/20 text-rose-300",
  completed: "bg-indigo-400/20 text-indigo-300",
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
        const d = await sessRes.json() as { sessions?: Session[] };
        setSessions(d.sessions ?? []);
      }
      if (workerRes?.ok) {
        const w = await workerRes.json() as WorkerStatus;
        setWorker(w);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh when running
  const latestSession = sessions[0];
  useEffect(() => {
    if (latestSession?.status === "running" || worker?.status === "running") {
      const t = setInterval(load, 5000);
      return () => clearInterval(t);
    }
  }, [latestSession?.status, worker?.status, load]);

  async function control(sessionId: number, action: string) {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/tournament/sessions/${sessionId}/control`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setError(data.error ?? "Lỗi."); return; }
      await load();
    } catch { setError("Không thể kết nối."); }
    finally { setBusy(false); }
  }

  async function createSession() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/tournament/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName || undefined,
          config: { max_parallel_matches: maxParallel, max_moves: maxMoves, new_agent_policy: newAgentPolicy, allow_rematch: allowRematch },
        }),
      });
      const data = await res.json() as { ok?: boolean; session_id?: number; total_pairs?: number; total_agents?: number; error?: string };
      if (!res.ok) { setError(data.error ?? "Lỗi tạo session."); return; }
      setShowNewForm(false); setNewName("");
      await load();
      setError(`✅ Đã tạo session #${data.session_id}: ${data.total_agents} agents, ${data.total_pairs} cặp đấu.`);
    } catch { setError("Không thể tạo session."); }
    finally { setBusy(false); }
  }

  const latest = sessions[0];
  const progressPct = latest && latest.total_matches > 0
    ? Math.round(latest.finished_matches / latest.total_matches * 100) : 0;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">← Dashboard</Link>
        </div>

        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">🎮 Tournament Control</h1>
            <p className="mt-1 text-slate-400">Quản lý hệ thống ghép trận tự động OTTv2.</p>
          </div>
          <button onClick={load} disabled={loading} className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/5 transition disabled:opacity-60">
            🔄 Làm mới
          </button>
        </div>

        {error && (
          <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${error.startsWith("✅") ? "border-teal-400/20 bg-teal-400/10 text-teal-200" : "border-rose-400/20 bg-rose-400/10 text-rose-200"}`}>
            {error}
          </div>
        )}

        {/* Worker status bar */}
        {worker && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-300">Worker:</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[worker.status] ?? "bg-slate-400/20 text-slate-300"}`}>
                  {worker.status}
                </span>
              </div>
              <div className="flex gap-5 text-xs text-slate-400 font-mono flex-wrap">
                <span>Queue: <span className="text-white">{worker.queue_depth}</span></span>
                <span>Active: <span className="text-emerald-400">{worker.active_count}</span></span>
                <span>Done: <span className="text-indigo-300">{worker.completed}</span></span>
                <span>Errors: <span className="text-rose-400">{worker.errors}</span></span>
              </div>
            </div>
            {worker.active_match_ids.length > 0 && (
              <p className="mt-2 text-xs text-slate-500 font-mono">
                Đang chạy: {worker.active_match_ids.join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Latest session card */}
        {latest && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-lg">{latest.name}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[latest.status] ?? "bg-slate-400/20 text-slate-300"}`}>
                    {latest.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Session #{latest.id} · Tạo {new Date(latest.created_at).toLocaleString("vi-VN")}
                  {latest.completed_at && ` · Xong ${new Date(latest.completed_at).toLocaleString("vi-VN")}`}
                </p>
              </div>
              {/* Control buttons */}
              <div className="flex gap-2 flex-wrap">
                {["idle","stopped"].includes(latest.status) && (
                  <button onClick={() => control(latest.id, "start")} disabled={busy}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition">
                    ▶ Start
                  </button>
                )}
                {latest.status === "running" && (
                  <button onClick={() => control(latest.id, "pause")} disabled={busy}
                    className="rounded-xl bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-500 disabled:opacity-60 transition">
                    ⏸ Pause
                  </button>
                )}
                {latest.status === "paused" && (
                  <button onClick={() => control(latest.id, "resume")} disabled={busy}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition">
                    ▶ Resume
                  </button>
                )}
                {["running","paused"].includes(latest.status) && (
                  <button onClick={() => control(latest.id, "stop")} disabled={busy}
                    className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60 transition">
                    ⏹ Stop
                  </button>
                )}
              </div>
            </div>

            {/* Progress */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span>{latest.finished_matches} / {latest.total_matches} trận hoàn thành</span>
                <span className="flex gap-3">
                  {latest.scheduled_matches > 0 && <span className="text-slate-500">⏳{latest.scheduled_matches} chờ</span>}
                  {latest.running_matches > 0 && <span className="text-emerald-400">⚡{latest.running_matches} đang chạy</span>}
                  {latest.error_matches > 0 && <span className="text-orange-400">⚠️{latest.error_matches} lỗi</span>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-indigo-400 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="mt-1 text-xs text-right text-slate-500">{progressPct}%</p>
            </div>

            {/* Config */}
            <div className="mt-3 flex gap-4 text-xs text-slate-500 flex-wrap">
              <span>⚡ Parallel: {(latest.config as Record<string, unknown>).max_parallel_matches as number ?? "?"}</span>
              <span>🎯 MaxMoves: {(latest.config as Record<string, unknown>).max_moves as number ?? "?"}</span>
              <span>📋 NewAgent: {String((latest.config as Record<string, unknown>).new_agent_policy ?? "exclude")}</span>
            </div>
          </div>
        )}

        {/* New session button */}
        <div className="mb-6">
          <button onClick={() => setShowNewForm(v => !v)}
            className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 transition">
            {showNewForm ? "✕ Hủy" : "+ Tạo Session Mới"}
          </button>
        </div>

        {showNewForm && (
          <div className="mb-8 rounded-2xl border border-indigo-400/20 bg-indigo-400/5 p-5">
            <h3 className="font-semibold text-indigo-200 mb-4">Cấu hình Session mới</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Tên session
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder={`Session ${new Date().toLocaleDateString("vi-VN")}`}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-indigo-300" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Max parallel matches (1–10)
                <input type="number" min={1} max={10} value={maxParallel} onChange={e => setMaxParallel(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-indigo-300" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Max moves per match
                <input type="number" min={50} max={1000} value={maxMoves} onChange={e => setMaxMoves(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-indigo-300" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Chính sách agent mới
                <select value={newAgentPolicy} onChange={e => setNewAgentPolicy(e.target.value)}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-indigo-300">
                  <option value="exclude">Exclude (không thêm khi đang chạy)</option>
                  <option value="include">Include (thêm agent mới vào queue)</option>
                </select>
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={allowRematch} onChange={e => setAllowRematch(e.target.checked)}
                className="rounded accent-indigo-400" />
              Cho phép đấu lại (allow rematch)
            </label>
            <button onClick={createSession} disabled={busy}
              className="mt-4 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 transition disabled:opacity-60">
              {busy ? "Đang tạo..." : "Tạo Session"}
            </button>
          </div>
        )}

        {/* All sessions */}
        <div>
          <h2 className="text-lg font-semibold mb-3">📋 Tất cả Sessions</h2>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-slate-500 text-sm">Chưa có session nào. Tạo session đầu tiên ở trên.</p>
          ) : (
            <div className="space-y-2">
              {sessions.slice(1).map(s => {
                const pct = s.total_matches > 0 ? Math.round(s.finished_matches / s.total_matches * 100) : 0;
                return (
                  <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{s.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[s.status] ?? "bg-slate-400/20 text-slate-300"}`}>{s.status}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>{s.finished_matches}/{s.total_matches}</span>
                        <div className="h-1 w-20 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-slate-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{new Date(s.created_at).toLocaleString("vi-VN")}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
