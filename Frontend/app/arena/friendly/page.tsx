"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GameBoard, applyMove, getPieceCounts, PIECE_EMOJI, type Piece } from "@/components/GameBoard";
import BackendOfflineBanner from "@/components/BackendOfflineBanner";

type AgentOption = {
  id: number;
  agent_name: string;
  username: string;
  user_id: number;
  elo: number;
};

type FriendlyMatch = {
  id: number;
  status: string;
  outcome: string | null;
  win_reason: string;
  total_moves: number;
  is_infra_error: boolean;
  created_at: string;
  finished_at: string | null;
  agent1_id: number;
  agent1_name: string;
  agent1_username: string;
  agent2_id: number;
  agent2_name: string;
  agent2_username: string;
  winner_name: string | null;
};

type LiveStep = {
  type: "step";
  step_number: number;
  player: number;
  move: { from_col: number; from_row: number; to_col: number; to_row: number; from_pos: string; to_pos: string } | null;
  captured_type: string | null;
  game_over: boolean;
  winner: number | null;
  win_reason: string;
  error: string | null;
};

// Build initial board matching game.py _init_board()
function buildInitialBoard(): Piece[] {
  const flat: Piece[] = Array(81).fill(null);
  function place(player: number, type: string, pos: string) {
    let col = -1, row = -1;
    for (const ch of pos) {
      if (isNaN(Number(ch))) col = ch.charCodeAt(0) - 97;
      else row = parseInt(ch) - 1;
    }
    if (col >= 0 && row >= 0) flat[row * 9 + col] = { player, type };
  }
  for (const p of ["5c","4d","3e"]) place(1,"SCISSORS",p);
  for (const p of ["5b","4c","3d","2e"]) place(1,"PAPER",p);
  for (const p of ["4b","3c","2d"]) place(1,"ROCK",p);
  for (const p of ["7e","6f","5g"]) place(2,"SCISSORS",p);
  for (const p of ["8e","7f","6g","5h"]) place(2,"PAPER",p);
  for (const p of ["8f","7g","6h"]) place(2,"ROCK",p);
  return flat;
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-slate-400/20 text-slate-300",
  running:   "bg-yellow-400/20 text-yellow-300",
  finished:  "bg-emerald-400/20 text-emerald-300",
  error:     "bg-rose-400/20 text-rose-300",
};

export default function FriendlyPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agent1Id, setAgent1Id] = useState<number | "">("");
  const [agent2Id, setAgent2Id] = useState<number | "">("");
  const [matches, setMatches] = useState<FriendlyMatch[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [error, setError] = useState("");

  // Backend online status
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null); // null = checking

  // Live match state
  const [liveActive, setLiveActive] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [liveBoard, setLiveBoard] = useState<Piece[]>(buildInitialBoard());
  const [liveLastMove, setLiveLastMove] = useState<LiveStep["move"]>(null);
  const [liveDone, setLiveDone] = useState<{ friendly_match_id: number; outcome: string; total_moves: number; win_reason: string } | null>(null);
  const [liveError, setLiveError] = useState("");
  const [liveAgent1, setLiveAgent1] = useState<AgentOption | null>(null);
  const [liveAgent2, setLiveAgent2] = useState<AgentOption | null>(null);
  const sseRef    = useRef<EventSource | null>(null);
  const moveLogRef = useRef<HTMLDivElement>(null);

  // Step queue: SSE pushes here, drain loop pops at ≥1.3s intervals
  const MIN_STEP_MS = 1300;
  type QueuedDone = { type: "done"; friendly_match_id: number; outcome: string; total_moves: number; win_reason: string };
  const stepQueueRef = useRef<(LiveStep | QueuedDone)[]>([]);
  const drainingRef  = useRef(false);
  const boardRef     = useRef<Piece[]>(buildInitialBoard()); // mutable board for queue drain

  // Drain loop: consume one item every MAX(1300ms, time-since-last)
  function startDrainLoop() {
    if (drainingRef.current) return;
    drainingRef.current = true;

    async function drain() {
      while (true) {
        const item = stepQueueRef.current.shift();
        if (!item) {
          // Queue empty — wait a bit then check again (SSE might still be sending)
          await new Promise(r => setTimeout(r, 80));
          if (stepQueueRef.current.length === 0) {
            drainingRef.current = false;
            return;
          }
          continue;
        }

        const start = Date.now();

        if (item.type === "done") {
          setLiveDone(item);
          loadMatches();
          drainingRef.current = false;
          return;
        }

        // It's a step
        const step = item as LiveStep;
        if (step.move) {
          boardRef.current = applyMove(boardRef.current, step.move);
          setLiveBoard([...boardRef.current]);
          setLiveLastMove(step.move);
        }
        setLiveSteps(prev => [...prev, step]);

        // Enforce minimum display time
        const elapsed = Date.now() - start;
        const remaining = MIN_STEP_MS - elapsed;
        if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      }
    }

    drain();
  }

  // Load agents
  useEffect(() => {
    fetch("/api/arena/agents/all-active")
      .then(r => { if (r.status === 401) { router.push("/login"); return null; } return r.json(); })
      .then((d: { agents?: AgentOption[] } | null) => { if (d) setAgents(d.agents ?? []); })
      .catch(() => setError("Không thể tải danh sách agent."))
      .finally(() => setLoadingAgents(false));
  }, [router]);

  // Check backend online status on mount
  useEffect(() => {
    fetch("/api/backend-status")
      .then(r => r.json())
      .then((d: { online: boolean }) => setBackendOnline(d.online))
      .catch(() => setBackendOnline(false));
  }, []);

  const loadMatches = useCallback(() => {
    setLoadingMatches(true);
    fetch("/api/friendly")
      .then(r => r.json())
      .then((d: { matches?: FriendlyMatch[] }) => setMatches(d.matches ?? []))
      .catch(() => {})
      .finally(() => setLoadingMatches(false));
  }, []);

  useEffect(() => { loadMatches(); }, [loadMatches]);

  // Auto-scroll move log
  useEffect(() => {
    if (moveLogRef.current) {
      moveLogRef.current.scrollTop = moveLogRef.current.scrollHeight;
    }
  }, [liveSteps]);

  function startLive() {
    if (!agent1Id || !agent2Id) { setError("Vui lòng chọn cả hai agent."); return; }
    const a1 = agents.find(a => a.id === agent1Id) ?? null;
    const a2 = agents.find(a => a.id === agent2Id) ?? null;
    if (a1 && a2 && a1.user_id === a2.user_id) { setError("Hai agent phải thuộc hai người dùng khác nhau."); return; }

    // Reset live state
    setLiveActive(true);
    setLiveSteps([]);
    const initBoard = buildInitialBoard();
    setLiveBoard(initBoard);
    boardRef.current = initBoard;
    setLiveLastMove(null);
    setLiveDone(null);
    setLiveError("");
    setLiveAgent1(a1);
    setLiveAgent2(a2);
    setError("");
    stepQueueRef.current = [];
    drainingRef.current = false;

    // Close existing SSE
    if (sseRef.current) { sseRef.current.close(); }

    const url = `/api/friendly/live?agent1_id=${agent1Id}&agent2_id=${agent2Id}`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as
        | { type: "step" } & LiveStep
        | { type: "done"; friendly_match_id: number; outcome: string; total_moves: number; win_reason: string }
        | { type: "error"; message: string };

      if (data.type === "error") {
        setLiveError(data.message);
        es.close();
        return;
      }

      // Push to queue — drain loop will pace the display
      stepQueueRef.current.push(data);
      startDrainLoop();
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setLiveError("Kết nối bị ngắt.");
      es.close();
    };
  }

  function resetLive() {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    stepQueueRef.current = [];
    drainingRef.current = false;
    setLiveActive(false);
    setLiveSteps([]);
    const initBoard = buildInitialBoard();
    setLiveBoard(initBoard);
    boardRef.current = initBoard;
    setLiveLastMove(null);
    setLiveDone(null);
    setLiveError("");
  }

  const pieceCounts = getPieceCounts(liveBoard);
  const isRunning = liveActive && !liveDone && !liveError;
  const selectedA1 = agents.find(a => a.id === agent1Id);
  const selectedA2 = agents.find(a => a.id === agent2Id);
  const sameUser = selectedA1 && selectedA2 && selectedA1.user_id === selectedA2.user_id;
  const byUser = agents.reduce<Record<number, AgentOption[]>>((acc, a) => {
    if (!acc[a.user_id]) acc[a.user_id] = [];
    acc[a.user_id].push(a);
    return acc;
  }, {});

  const outcomeLabel = liveDone
    ? liveDone.outcome === "agent1"
      ? `🏆 ${liveAgent1?.agent_name ?? "Agent 1"} thắng!`
      : liveDone.outcome === "agent2"
      ? `🏆 ${liveAgent2?.agent_name ?? "Agent 2"} thắng!`
      : "🤝 Hòa!"
    : null;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-6xl">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
          <span className="text-slate-700">/</span>
          <Link href="/arena/leaderboard" className="hover:text-white">Arena</Link>
          <span className="text-slate-700">/</span>
          <span className="text-white">Đấu Đối Kháng Riêng</span>
        </div>

        <div className="mb-2 flex items-center gap-3">
          <h1 className="text-3xl font-bold">⚔️ Đấu Đối Kháng Riêng</h1>
        </div>
        <p className="mb-6 text-slate-400 text-sm">
          Xem live từng nước đi. Kết quả không tính ELO leaderboard chính thức.
        </p>

        {/* Backend offline banner */}
        <BackendOfflineBanner
          isOffline={backendOnline === false}
          checking={backendOnline === null}
          className="mb-6"
        />

        {/* Selector + fight button */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 mb-6">
          {loadingAgents ? (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 items-end">
              {/* Agent 1 */}
              <div className="flex-1 min-w-[180px]">
                <p className="text-xs text-blue-400 mb-1.5 font-semibold">🟦 Player 1</p>
                <select
                  value={agent1Id}
                  onChange={e => setAgent1Id(e.target.value ? Number(e.target.value) : "")}
                  disabled={isRunning}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-blue-400/50 text-sm disabled:opacity-50"
                >
                  <option value="">-- Chọn agent --</option>
                  {Object.entries(byUser).map(([, list]) => (
                    <optgroup key={list[0].username} label={`@${list[0].username}`}>
                      {list.map(a => (
                        <option key={a.id} value={a.id} disabled={a.id === agent2Id}>
                          {a.agent_name} (ELO {a.elo})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <span className="text-2xl font-black text-slate-600 pb-1">VS</span>

              {/* Agent 2 */}
              <div className="flex-1 min-w-[180px]">
                <p className="text-xs text-rose-400 mb-1.5 font-semibold">🟥 Player 2</p>
                <select
                  value={agent2Id}
                  onChange={e => setAgent2Id(e.target.value ? Number(e.target.value) : "")}
                  disabled={isRunning}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-rose-400/50 text-sm disabled:opacity-50"
                >
                  <option value="">-- Chọn agent --</option>
                  {Object.entries(byUser).map(([, list]) => (
                    <optgroup key={list[0].username} label={`@${list[0].username}`}>
                      {list.map(a => (
                        <option key={a.id} value={a.id} disabled={a.id === agent1Id}>
                          {a.agent_name} (ELO {a.elo})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pb-0.5">
                {!liveActive ? (
                  <button
                    onClick={startLive}
                    disabled={!agent1Id || !agent2Id || !!sameUser || agent1Id === agent2Id || backendOnline === false || backendOnline === null}
                    className="rounded-xl bg-rose-500 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    title={backendOnline === false ? "Backend đang offline" : undefined}
                  >
                    {backendOnline === null ? "⏳ Đang kiểm tra..." : "⚔️ Bắt đầu"}
                  </button>
                ) : (
                  <button
                    onClick={resetLive}
                    className="rounded-xl border border-white/15 px-5 py-2 text-sm font-semibold hover:bg-white/5 transition"
                  >
                    ↩ Trận mới
                  </button>
                )}
              </div>
            </div>
          )}

          {sameUser && (
            <p className="mt-3 text-xs text-orange-300">⚠️ Hai agent phải thuộc hai người dùng khác nhau.</p>
          )}
          {error && <p className="mt-3 text-xs text-rose-300">❌ {error}</p>}
        </div>

        {/* Live match area */}
        {liveActive && (
          <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_300px]">
            {/* Board */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              {/* Player headers */}
              <div className="flex justify-between mb-3">
                {[
                  { agent: liveAgent2, p: 2, color: "text-rose-300", border: "border-rose-400/20 bg-rose-400/5" },
                  { agent: liveAgent1, p: 1, color: "text-blue-300", border: "border-blue-400/20 bg-blue-400/5" },
                ].map(({ agent, p, color, border }) => {
                  const c = pieceCounts[p];
                  return (
                    <div key={p} className={`rounded-xl border ${border} px-3 py-2 text-xs flex-1 ${p === 1 ? "ml-2" : "mr-2"}`}>
                      <div className={`font-semibold ${color} mb-1`}>{agent?.agent_name ?? `Agent ${p}`}</div>
                      <div className="flex gap-2 font-mono text-slate-300">
                        <span>✊<span className="text-yellow-300 font-bold">{c.ROCK}</span></span>
                        <span>✋<span className="text-yellow-300 font-bold">{c.PAPER}</span></span>
                        <span>✌️<span className="text-yellow-300 font-bold">{c.SCISSORS}</span></span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Status bar */}
              <div className="flex items-center justify-between mb-3 text-xs">
                <div className="flex items-center gap-2">
                  {isRunning && (
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  <span className="text-slate-400">
                    {isRunning
                      ? `Đang chạy... nước ${liveSteps.length}`
                      : liveDone
                      ? `Kết thúc · ${liveDone.total_moves} nước`
                      : liveError
                      ? "⚠️ Lỗi"
                      : ""}
                  </span>
                </div>
                {liveDone && (
                  <Link
                    href={`/arena/replay/friendly/${liveDone.friendly_match_id}`}
                    className="rounded-lg border border-indigo-400/30 px-3 py-1 text-indigo-300 hover:bg-indigo-400/10 transition"
                  >
                    ▶ Replay đầy đủ
                  </Link>
                )}
              </div>

              {/* Winner banner */}
              {liveDone && outcomeLabel && (
                <div className="mb-3 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-2.5 text-center">
                  <p className="font-bold text-yellow-300 text-lg">{outcomeLabel}</p>
                  {liveDone.win_reason && (
                    <p className="text-xs text-slate-400 mt-0.5">{liveDone.win_reason}</p>
                  )}
                </div>
              )}

              {liveError && (
                <div className="mb-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-2.5 text-center">
                  <p className="text-rose-300 text-sm">⚠️ {liveError}</p>
                </div>
              )}

              <GameBoard board={liveBoard} lastMove={liveLastMove} />
            </div>

            {/* Move log */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-200 text-sm">📜 Nhật ký nước đi</h3>
                <span className="text-xs text-slate-500 font-mono">{liveSteps.length} nước</span>
              </div>
              <div
                ref={moveLogRef}
                className="flex-1 overflow-y-auto space-y-0.5 pr-1"
                style={{ maxHeight: 480 }}
              >
                {liveSteps.length === 0 && (
                  <p className="text-slate-600 text-xs text-center py-8">Chờ trận bắt đầu...</p>
                )}
                {liveSteps.map((s, i) => {
                  const pColor = s.player === 1 ? "text-blue-400" : "text-rose-400";
                  const isLast = i === liveSteps.length - 1;
                  return (
                    <div
                      key={s.step_number}
                      className={`rounded px-2 py-1 text-xs font-mono transition ${
                        isLast ? "bg-indigo-400/20 text-white" : "text-slate-400"
                      }`}
                    >
                      <span className="text-slate-600 w-6 inline-block">{s.step_number}.</span>
                      <span className={`${pColor} font-semibold`}>P{s.player}</span>
                      {s.move
                        ? <> {s.move.from_pos}→{s.move.to_pos}{s.captured_type && <span className="text-yellow-400"> ×{PIECE_EMOJI[s.captured_type]}</span>}</>
                        : <span className="text-orange-400"> [lỗi]</span>
                      }
                      {s.game_over && <span className="text-yellow-300 ml-1">⚑</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Match history */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="font-semibold">📋 Lịch sử trận đối kháng</h2>
            <button
              onClick={loadMatches}
              className="text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-1.5 hover:bg-white/5 transition"
            >
              🔄 Làm mới
            </button>
          </div>

          {loadingMatches ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
            </div>
          ) : matches.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-slate-500 text-sm">Chưa có trận đối kháng nào.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-white/10 text-left">
                    <th className="px-4 py-3 font-medium">Agent 1 🟦</th>
                    <th className="px-3 py-3 text-center">vs</th>
                    <th className="px-4 py-3 font-medium">Agent 2 🟥</th>
                    <th className="px-4 py-3 font-medium">Kết quả</th>
                    <th className="px-4 py-3 text-right font-medium">Nước</th>
                    <th className="px-4 py-3 font-medium">TT</th>
                    <th className="px-4 py-3 text-right font-medium">Thời gian</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {matches.map(m => (
                    <tr key={m.id} className={`hover:bg-white/[0.02] ${m.is_infra_error ? "opacity-60" : ""}`}>
                      <td className="px-4 py-2.5">
                        <Link href={`/arena/agents/${m.agent1_id}`} className="font-medium text-blue-200 hover:text-blue-300">{m.agent1_name}</Link>
                        <p className="text-xs text-slate-500">@{m.agent1_username}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-slate-600 font-bold">vs</td>
                      <td className="px-4 py-2.5">
                        <Link href={`/arena/agents/${m.agent2_id}`} className="font-medium text-rose-200 hover:text-rose-300">{m.agent2_name}</Link>
                        <p className="text-xs text-slate-500">@{m.agent2_username}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {m.is_infra_error
                          ? <span className="text-orange-400 text-xs">⚠️ Lỗi</span>
                          : m.winner_name
                          ? <span className="font-semibold text-yellow-300 text-xs">🏆 {m.winner_name}</span>
                          : m.outcome === "draw"
                          ? <span className="text-slate-400 text-xs">🤝 Hòa</span>
                          : <span className="text-slate-500 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-400">{m.total_moves}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[m.status] ?? ""}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                        {new Date(m.created_at).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-2.5">
                        {m.status === "finished" && !m.is_infra_error && (
                          <Link
                            href={`/arena/replay/friendly/${m.id}`}
                            className="rounded-lg border border-indigo-400/30 px-2 py-1 text-xs text-indigo-300 hover:bg-indigo-400/10 transition"
                          >
                            ▶ Replay
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
