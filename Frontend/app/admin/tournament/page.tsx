"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

// ─── Types ────────────────────────────────────────────────────────────────────

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

type PairPreview = {
  agent1_id: number;
  agent1_name: string;
  agent1_username: string;
  agent2_id: number;
  agent2_name: string;
  agent2_username: string;
  key: string;
  fight_count: number;
  last_session_id: number | null;
  last_session_name: string | null;
  last_outcome: string | null;
  played_in_prev_session: boolean;
  history_summary: Array<{
    session_id: number;
    session_name: string;
    outcome: string | null;
    finished_at: string | null;
  }>;
};

type PreviewData = {
  pairs: PairPreview[];
  total_agents: number;
  total_pairs_all: number;
  total_pairs_preview: number;
  prev_session: { id: number; name: string; created_at: string } | null;
  prev_session_excluded: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  idle: "bg-slate-100 text-slate-700 border-slate-300",
  running: "bg-emerald-50 text-emerald-700 border-emerald-300",
  paused: "bg-amber-50 text-amber-700 border-amber-300",
  stopped: "bg-rose-50 text-rose-700 border-rose-300",
  completed: "bg-[#253B80]/10 text-[#253B80] border-[#253B80]/30",
};

const OUTCOME_LABEL: Record<string, string> = {
  agent1: "Bot1 thắng",
  agent2: "Bot2 thắng",
  draw: "Hòa",
};

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ─── Component ────────────────────────────────────────────────────────────────

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

  // Preview / confirm-pairs state
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Set of pair keys currently selected
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set());
  // Include pairs that were in the previous session
  const [includePrevSession, setIncludePrevSession] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // ─── Data loading ──────────────────────────────────────────────────────────

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

  // ─── Session control ───────────────────────────────────────────────────────

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

  // ─── Step 1: Create session (no matches yet) ───────────────────────────────

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
        needs_pair_confirmation?: boolean;
        error?: string;
      };
      if (!res.ok || !data.session_id) {
        setError(data.error ?? "Lỗi tạo session.");
        return;
      }

      setShowNewForm(false);
      setNewName("");
      await load();

      if (data.needs_pair_confirmation && data.session_id) {
        // Bước 2: load preview và show modal
        await loadPreview(data.session_id, false);
      }
    } catch {
      setError("Không thể tạo session.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Step 2: Load pair preview ─────────────────────────────────────────────

  async function loadPreview(sessionId: number, includePrev: boolean) {
    setPreviewLoading(true);
    setPreviewSessionId(sessionId);
    setPreviewData(null);
    setSelectedPairs(new Set());
    try {
      const res = await fetch(
        `/api/tournament/sessions/preview?include_prev_session_pairs=${includePrev}`,
      );
      const data = (await res.json()) as PreviewData & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Không thể load preview.");
        setPreviewSessionId(null);
        return;
      }
      setPreviewData(data);
      // Mặc định: chọn tất cả pairs
      setSelectedPairs(new Set(data.pairs.map((p) => p.key)));
    } catch {
      setError("Không thể load preview.");
      setPreviewSessionId(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Toggle include_prev_session và reload preview
  async function toggleIncludePrev(val: boolean) {
    setIncludePrevSession(val);
    if (previewSessionId !== null) {
      await loadPreview(previewSessionId, val);
    }
  }

  // Toggle 1 pair
  function togglePair(key: string) {
    setSelectedPairs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Select all / deselect all
  function selectAll() {
    if (!previewData) return;
    setSelectedPairs(new Set(previewData.pairs.map((p) => p.key)));
  }

  function deselectAll() {
    setSelectedPairs(new Set());
  }

  // Loại bỏ nhanh các cặp đã từng đấu nhau (fight_count > 0)
  function excludeAlreadyFought() {
    if (!previewData) return;
    setSelectedPairs((prev) => {
      const next = new Set(prev);
      for (const p of previewData.pairs) {
        if (p.fight_count > 0) next.delete(p.key);
      }
      return next;
    });
  }

  // ─── Step 3: Confirm pairs → insert matches ────────────────────────────────

  async function confirmPairs() {
    if (!previewSessionId || selectedPairs.size === 0 || !previewData) return;
    setConfirmBusy(true);
    setError("");
    try {
      const chosenPairs = previewData.pairs
        .filter((p) => selectedPairs.has(p.key))
        .map((p) => ({ agent1_id: p.agent1_id, agent2_id: p.agent2_id }));

      const res = await fetch(
        `/api/tournament/sessions/${previewSessionId}/confirm-pairs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairs: chosenPairs }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        inserted?: number;
        skipped_count?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Lỗi xác nhận cặp đấu.");
        return;
      }

      // Done — close preview
      setPreviewSessionId(null);
      setPreviewData(null);
      setSelectedPairs(new Set());
      await load();
      setError(
        `✅ Đã tạo session #${previewSessionId}: ${data.inserted} cặp đấu được xác nhận.`,
      );
    } catch {
      setError("Không thể xác nhận cặp đấu.");
    } finally {
      setConfirmBusy(false);
    }
  }

  function cancelPreview() {
    setPreviewSessionId(null);
    setPreviewData(null);
    setSelectedPairs(new Set());
    setIncludePrevSession(false);
  }

  // ─── Render helpers ────────────────────────────────────────────────────────

  const latest = sessions[0];
  const progressPct =
    latest && latest.total_matches > 0
      ? Math.round((latest.finished_matches / latest.total_matches) * 100)
      : 0;

  const freshPairs = previewData?.pairs.filter((p) => p.fight_count === 0) ?? [];
  const rematchPairs = previewData?.pairs.filter((p) => p.fight_count > 0) ?? [];
  const selectedCount = selectedPairs.size;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
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

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-[#1a1e29]">🎮 Tournament Control</h1>
            <p className="mt-1 text-sm text-slate-600">
              Quản lý hệ thống ghép trận đấu tự động OTTv2 Arena.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-[#253B80] disabled:opacity-50"
          >
            🔄 Làm mới
          </button>
        </div>

        {/* Error / success banner */}
        {error && (
          <div
            className={`mb-6 rounded-none border px-4 py-3 text-sm font-bold ${
              error.startsWith("✅")
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-rose-300 bg-rose-50 text-rose-800"
            }`}
          >
            {error}
            <button
              onClick={() => setError("")}
              className="ml-3 text-xs font-normal opacity-60 hover:opacity-100"
            >
              ✕ Đóng
            </button>
          </div>
        )}

        {/* ── PREVIEW PANEL ─────────────────────────────────────────────────── */}
        {previewSessionId !== null && (
          <div className="mb-8 rounded-none border-2 border-[#253B80] bg-white shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#ded8d3] bg-[#253B80]/5 px-5 py-4">
              <div>
                <h3 className="text-base font-extrabold text-[#253B80]">
                  🗂️ Preview cặp đấu — Session #{previewSessionId}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Chọn các cặp muốn đưa vào session, sau đó nhấn &quot;Xác nhận&quot;.
                </p>
              </div>
              <button
                onClick={cancelPreview}
                className="cursor-pointer rounded-none border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
              >
                ✕ Huỷ session này
              </button>
            </div>

            {previewLoading ? (
              <div className="flex justify-center py-12">
                <div className="h-7 w-7 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
              </div>
            ) : previewData ? (
              <div className="p-5">
                {/* Stats row */}
                <div className="mb-4 flex flex-wrap gap-4 font-mono text-xs text-slate-600">
                  <span>
                    Agents active:{" "}
                    <strong className="text-[#1a1e29]">{previewData.total_agents}</strong>
                  </span>
                  <span>
                    Tổng cặp có thể:{" "}
                    <strong className="text-[#1a1e29]">{previewData.total_pairs_all}</strong>
                  </span>
                  <span>
                    Đang hiển thị:{" "}
                    <strong className="text-[#1a1e29]">{previewData.total_pairs_preview}</strong>
                  </span>
                  <span>
                    Đã chọn:{" "}
                    <strong className="text-[#253B80]">{selectedCount}</strong>
                  </span>
                  {previewData.prev_session && (
                    <span className="text-amber-600">
                      Session trước:{" "}
                      <strong>
                        #{previewData.prev_session.id} {previewData.prev_session.name}
                      </strong>
                    </span>
                  )}
                </div>

                {/* Filter controls */}
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  {/* Toggle include prev session pairs */}
                  <label className="flex cursor-pointer items-center gap-2 rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#253B80]">
                    <input
                      type="checkbox"
                      checked={includePrevSession}
                      onChange={(e) => toggleIncludePrev(e.target.checked)}
                      className="accent-[#253B80]"
                    />
                    Hiện cặp đã đấu session trước
                    {previewData.prev_session_excluded > 0 && (
                      <span className="ml-1 rounded-none bg-amber-100 px-1.5 py-0.5 text-amber-700">
                        {previewData.prev_session_excluded} bị ẩn
                      </span>
                    )}
                  </label>

                  {/* Quick actions */}
                  <button
                    onClick={selectAll}
                    className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-[#253B80] hover:text-[#253B80]"
                  >
                    ✓ Chọn tất cả
                  </button>
                  <button
                    onClick={deselectAll}
                    className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-rose-400 hover:text-rose-700"
                  >
                    ✗ Bỏ chọn tất cả
                  </button>
                  <button
                    onClick={excludeAlreadyFought}
                    title="Bỏ chọn tất cả cặp đã từng đấu nhau (ở bất kỳ session nào)"
                    className="cursor-pointer rounded-none border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                  >
                    ⚡ Loại cặp đã từng đấu
                  </button>
                </div>

                {/* Pairs list */}
                {previewData.pairs.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    Không có cặp đấu nào.
                    {!includePrevSession && previewData.prev_session_excluded > 0 && (
                      <span className="block mt-1 text-xs">
                        ({previewData.prev_session_excluded} cặp bị ẩn do đã đấu session trước — bật toggle ở trên để xem)
                      </span>
                    )}
                  </p>
                ) : (
                  <>
                    {/* Fresh pairs (chưa từng đấu) */}
                    {freshPairs.length > 0 && (
                      <div className="mb-4">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                          🆕 Lần đầu đấu ({freshPairs.length})
                        </p>
                        <div className="space-y-1">
                          {freshPairs.map((pair) => (
                            <PairRow
                              key={pair.key}
                              pair={pair}
                              selected={selectedPairs.has(pair.key)}
                              onToggle={() => togglePair(pair.key)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rematch pairs (đã từng đấu) */}
                    {rematchPairs.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">
                          🔁 Đã từng đấu ({rematchPairs.length})
                        </p>
                        <div className="space-y-1">
                          {rematchPairs.map((pair) => (
                            <PairRow
                              key={pair.key}
                              pair={pair}
                              selected={selectedPairs.has(pair.key)}
                              onToggle={() => togglePair(pair.key)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Confirm button */}
                <div className="mt-6 flex items-center justify-between border-t border-[#ded8d3] pt-4">
                  <p className="text-xs text-slate-500">
                    {selectedCount === 0
                      ? "Chưa chọn cặp đấu nào."
                      : `${selectedCount} cặp đấu sẽ được tạo.`}
                  </p>
                  <button
                    onClick={confirmPairs}
                    disabled={confirmBusy || selectedCount === 0}
                    className="cursor-pointer rounded-none bg-[#253B80] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmBusy
                      ? "Đang xác nhận..."
                      : `✅ Xác nhận ${selectedCount} cặp đấu`}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ── WORKER STATUS ──────────────────────────────────────────────────── */}
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
                <span>
                  Hàng đợi: <strong className="text-[#1a1e29]">{worker.queue_depth}</strong>
                </span>
                <span>
                  Đang chạy: <strong className="text-emerald-700">{worker.active_count}</strong>
                </span>
                <span>
                  Hoàn tất: <strong className="text-[#253B80]">{worker.completed}</strong>
                </span>
                <span>
                  Lỗi: <strong className="text-rose-700">{worker.errors}</strong>
                </span>
              </div>
            </div>
            {worker.active_match_ids.length > 0 && (
              <p className="mt-2 font-mono text-xs text-slate-500">
                Trận đang chạy ID: {worker.active_match_ids.join(", ")}
              </p>
            )}
          </div>
        )}

        {/* ── LATEST SESSION ─────────────────────────────────────────────────── */}
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
                  {latest.status === "idle" && latest.total_matches === 0 && (
                    <span className="rounded-none border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
                      ⏳ Chờ xác nhận cặp đấu
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Session #{latest.id} · Tạo{" "}
                  {new Date(latest.created_at).toLocaleString("vi-VN")}
                  {latest.completed_at &&
                    ` · Xong ${new Date(latest.completed_at).toLocaleString("vi-VN")}`}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Show "Xác nhận cặp đấu" if session has no matches yet */}
                {latest.status === "idle" && latest.total_matches === 0 && (
                  <button
                    onClick={() => loadPreview(latest.id, includePrevSession)}
                    disabled={previewLoading}
                    className="cursor-pointer rounded-none border border-[#253B80] bg-white px-4 py-2 text-xs font-bold text-[#253B80] transition hover:bg-[#253B80] hover:text-white disabled:opacity-50"
                  >
                    🗂️ Chọn cặp đấu
                  </button>
                )}
                {["idle", "stopped"].includes(latest.status) &&
                  latest.total_matches > 0 && (
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
            {latest.total_matches > 0 && (
              <div className="mt-5 border-t border-[#ded8d3] pt-4">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    Đã hoàn thành:{" "}
                    <strong className="text-[#1a1e29]">{latest.finished_matches}</strong> /{" "}
                    {latest.total_matches} trận
                  </span>
                  <span className="flex gap-3">
                    {latest.scheduled_matches > 0 && (
                      <span>⏳ {latest.scheduled_matches} chờ</span>
                    )}
                    {latest.running_matches > 0 && (
                      <span className="font-bold text-emerald-700">
                        ⚡ {latest.running_matches} chạy
                      </span>
                    )}
                    {latest.error_matches > 0 && (
                      <span className="font-bold text-rose-700">
                        ⚠️ {latest.error_matches} lỗi
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-none border border-[#ded8d3] bg-stone-200">
                  <div
                    className="h-full bg-[#253B80] transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1 text-right font-mono text-xs font-bold text-[#253B80]">
                  {progressPct}%
                </p>
              </div>
            )}

            {/* Config */}
            <div className="mt-3 flex flex-wrap gap-4 font-mono text-xs text-slate-500">
              <span>
                ⚡ Parallel:{" "}
                {(latest.config.max_parallel_matches as number) ?? "?"}
              </span>
              <span>
                🎯 MaxMoves: {(latest.config.max_moves as number) ?? "?"}
              </span>
              <span>
                📋 Policy:{" "}
                {String(latest.config.new_agent_policy ?? "exclude")}
              </span>
            </div>
          </div>
        )}

        {/* ── CREATE SESSION BUTTON ──────────────────────────────────────────── */}
        <div className="mb-6">
          <button
            onClick={() => setShowNewForm((v) => !v)}
            disabled={previewSessionId !== null}
            title={
              previewSessionId !== null
                ? "Hoàn tất preview hiện tại trước khi tạo session mới"
                : undefined
            }
            className="cursor-pointer rounded-none bg-[#253B80] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {showNewForm ? "✕ Đóng form" : "+ Tạo Mùa Giải Mới (Session)"}
          </button>
        </div>

        {showNewForm && (
          <div className="mb-8 rounded-none border border-[#ded8d3] bg-white p-6 shadow-md">
            <h3 className="mb-4 text-base font-bold text-[#253B80]">
              Cấu hình Session mới
            </h3>
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
                  <option value="exclude">
                    Exclude (không thêm vào giải đang chạy)
                  </option>
                  <option value="include">
                    Include (tự động ghép thêm vào queue)
                  </option>
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
              {busy ? "Đang tạo..." : "Tạo Session → Chọn cặp đấu"}
            </button>
          </div>
        )}

        {/* ── ALL SESSIONS LIST ──────────────────────────────────────────────── */}
        <div>
          <h2 className="mb-3 text-base font-bold text-[#1a1e29]">
            📋 Danh sách các Sessions
          </h2>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-slate-500">
              Chưa có session nào. Nhấn nút tạo ở trên.
            </p>
          ) : (
            <div className="space-y-2">
              {sessions.slice(1).map((s) => {
                const pct =
                  s.total_matches > 0
                    ? Math.round((s.finished_matches / s.total_matches) * 100)
                    : 0;
                return (
                  <div
                    key={s.id}
                    className="rounded-none border border-[#ded8d3] bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#1a1e29]">
                          {s.name}
                        </span>
                        <span
                          className={`rounded-none border px-2 py-0.5 text-xs font-bold ${
                            STATUS_BADGE[s.status] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {s.status}
                        </span>
                        {s.status === "idle" && s.total_matches === 0 && (
                          <button
                            onClick={() => loadPreview(s.id, false)}
                            className="cursor-pointer rounded-none border border-[#253B80] px-2 py-0.5 text-xs font-bold text-[#253B80] hover:bg-[#253B80] hover:text-white"
                          >
                            Chọn cặp đấu
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-3 font-mono text-xs text-slate-600">
                        <span>
                          {s.finished_matches}/{s.total_matches}
                        </span>
                        <div className="h-1.5 w-20 overflow-hidden rounded-none border border-[#ded8d3] bg-stone-200">
                          <div
                            className="h-full bg-[#253B80]"
                            style={{ width: `${pct}%` }}
                          />
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

// ─── PairRow sub-component ────────────────────────────────────────────────────

function PairRow({
  pair,
  selected,
  onToggle,
}: {
  pair: PairPreview;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const outcomeColor = (outcome: string | null) => {
    if (outcome === "agent1" || outcome === "agent2") return "text-emerald-700";
    if (outcome === "draw") return "text-slate-500";
    return "text-slate-400";
  };

  return (
    <div
      className={`rounded-none border transition-colors ${
        selected
          ? "border-[#253B80]/40 bg-[#253B80]/5"
          : "border-[#ded8d3] bg-white opacity-60"
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 cursor-pointer accent-[#253B80]"
        />

        {/* Bot names */}
        <div className="flex flex-1 flex-wrap items-center gap-1 font-mono text-xs">
          <span className="font-bold text-[#1a1e29]">{pair.agent1_name}</span>
          <span className="text-slate-400">({pair.agent1_username})</span>
          <span className="mx-1 text-slate-400">vs</span>
          <span className="font-bold text-[#1a1e29]">{pair.agent2_name}</span>
          <span className="text-slate-400">({pair.agent2_username})</span>
        </div>

        {/* History badge */}
        {pair.fight_count === 0 ? (
          <span className="whitespace-nowrap rounded-none border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            🆕 Lần đầu
          </span>
        ) : (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer whitespace-nowrap rounded-none border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
          >
            🔁 {pair.fight_count} lần đấu {expanded ? "▲" : "▼"}
          </button>
        )}

        {/* Last outcome */}
        {pair.last_outcome && (
          <span
            className={`whitespace-nowrap text-[11px] font-semibold ${outcomeColor(pair.last_outcome)}`}
          >
            Kq cuối: {OUTCOME_LABEL[pair.last_outcome] ?? pair.last_outcome}
          </span>
        )}
      </div>

      {/* Expanded history */}
      {expanded && pair.history_summary.length > 0 && (
        <div className="border-t border-[#ded8d3] bg-stone-50 px-4 py-2">
          <p className="mb-1 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            Lịch sử đấu (5 trận gần nhất)
          </p>
          <div className="space-y-0.5">
            {pair.history_summary.map((h, i) => (
              <div key={i} className="flex items-center gap-3 font-mono text-[11px] text-slate-600">
                <span className="text-slate-400">#{h.session_id}</span>
                <span className="truncate max-w-[200px]">{h.session_name}</span>
                <span className={`font-bold ${outcomeColor(h.outcome)}`}>
                  {h.outcome ? (OUTCOME_LABEL[h.outcome] ?? h.outcome) : "N/A"}
                </span>
                {h.finished_at && (
                  <span className="text-slate-400">
                    {new Date(h.finished_at).toLocaleDateString("vi-VN")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
