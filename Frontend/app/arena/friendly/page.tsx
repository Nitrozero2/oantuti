"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GameBoard, applyMove, getPieceCounts, PIECE_EMOJI, type Piece } from "@/components/GameBoard";
import BackendOfflineBanner from "@/components/BackendOfflineBanner";
import Navbar from "@/components/Navbar";

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
  scheduled: "bg-slate-100 text-slate-700 border-slate-300",
  running:   "bg-amber-50 text-amber-700 border-amber-300",
  finished:  "bg-emerald-50 text-emerald-700 border-emerald-300",
  error:     "bg-rose-50 text-rose-700 border-rose-300",
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
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  // Live match state
  const [liveActive, setLiveActive] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [liveBoard, setLiveBoard] = useState<Piece[]>(buildInitialBoard());
  const [liveLastMove, setLiveLastMove] = useState<LiveStep["move"]>(null);
  const [liveDone, setLiveDone] = useState<{ friendly_match_id: number; outcome: string; total_moves: number; win_reason: string } | null>(null);
  const [liveError, setLiveError] = useState("");
  const [liveAgent1, setLiveAgent1] = useState<AgentOption | null>(null);
  const [liveAgent2, setLiveAgent2] = useState<AgentOption | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const moveLogRef = useRef<HTMLDivElement>(null);

  const MIN_STEP_MS = 1300;
  type QueueItem =
    | ({ type: "step" } & LiveStep)
    | { type: "done"; friendly_match_id: number; outcome: string; total_moves: number; win_reason: string }
    | { type: "error"; message: string };

  const stepQueueRef = useRef<QueueItem[]>([]);
  const drainingRef  = useRef<boolean>(false);
  const boardRef     = useRef<Piece[]>(buildInitialBoard());

  const applyQueueItem = useCallback((item: QueueItem) => {
    if (item.type === "step") {
      setLiveSteps(prev => [...prev, item]);
      if (item.move) {
        boardRef.current = applyMove(boardRef.current, item.move);
        setLiveBoard([...boardRef.current]);
        setLiveLastMove(item.move);
      }
      if (item.error) { setLiveError(item.error); }
      setTimeout(() => {
        if (moveLogRef.current) {
          moveLogRef.current.scrollTop = moveLogRef.current.scrollHeight;
        }
      }, 50);
    } else if (item.type === "done") {
      setLiveDone(item);
      loadMatches();
    } else if (item.type === "error") {
      setLiveError(item.message);
    }
  }, []);

  const startDrainLoop = useCallback(() => {
    if (drainingRef.current) return;
    drainingRef.current = true;

    function tick() {
      if (stepQueueRef.current.length === 0) {
        drainingRef.current = false;
        return;
      }
      const item = stepQueueRef.current.shift()!;
      applyQueueItem(item);
      setTimeout(tick, MIN_STEP_MS);
    }
    tick();
  }, [applyQueueItem]);

  useEffect(() => {
    fetch("/api/backend-status")
      .then(r => r.ok ? r.json() : { online: false })
      .then((d: { online: boolean }) => setBackendOnline(d.online))
      .catch(() => setBackendOnline(false));

    fetch("/api/arena/agents/all-active")
      .then(r => {
        if (r.status === 401) { router.push("/login"); return null; }
        return r.json();
      })
      .then((d: { agents?: AgentOption[] } | null) => {
        if (d?.agents) setAgents(d.agents);
      })
      .catch(() => setError("Không thể tải danh sách agent."))
      .finally(() => setLoadingAgents(false));

    loadMatches();

    return () => {
      if (sseRef.current) sseRef.current.close();
    };
  }, [router]);

  function loadMatches() {
    setLoadingMatches(true);
    fetch("/api/friendly")
      .then(r => r.ok ? r.json() : null)
      .then((d: { matches?: FriendlyMatch[] } | null) => {
        if (d?.matches) setMatches(d.matches);
      })
      .catch(() => {})
      .finally(() => setLoadingMatches(false));
  }

  function startLive() {
    if (!agent1Id || !agent2Id) return;
    const a1 = agents.find(a => a.id === agent1Id) ?? null;
    const a2 = agents.find(a => a.id === agent2Id) ?? null;
    if (a1 && a2 && a1.user_id === a2.user_id) {
      setError("Hai agent phải thuộc hai người dùng khác nhau.");
      return;
    }

    const initBoard = buildInitialBoard();
    setLiveBoard(initBoard);
    boardRef.current = initBoard;
    setLiveSteps([]);
    setLiveLastMove(null);
    setLiveActive(true);
    setLiveDone(null);
    setLiveError("");
    setLiveAgent1(a1);
    setLiveAgent2(a2);
    setError("");
    stepQueueRef.current = [];
    drainingRef.current = false;

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
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      {/* Header đồng bộ */}
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 border-b border-[#ded8d3] pb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#1a1e29] sm:text-4xl">
              ⚔️ Đấu Đối Kháng Riêng
            </h1>
          </div>
          <p className="text-sm text-slate-600">
            Xem trực tiếp từng nước đi của hai agent. Trận đấu thử không tính điểm vào bảng xếp hạng ELO chính thức.
          </p>
        </div>

        {/* Backend offline banner */}
        <BackendOfflineBanner
          isOffline={backendOnline === false}
          checking={backendOnline === null}
          className="mb-6 rounded-none border border-amber-300 bg-amber-50 text-amber-900"
        />

        {/* Khung chọn Agent: Khung thẳng */}
        <div className="mb-8 rounded-none border border-[#ded8d3] bg-white p-6 shadow-md">
          {loadingAgents ? (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              {/* Agent 1 */}
              <div className="min-w-[200px] flex-1">
                <p className="mb-1.5 font-bold text-xs text-[#253B80]">🟦 Player 1 (Xanh)</p>
                <select
                  value={agent1Id}
                  onChange={(e) => setAgent1Id(e.target.value ? Number(e.target.value) : "")}
                  disabled={isRunning}
                  className="w-full rounded-none border border-[#ded8d3] bg-white px-3 py-2.5 text-sm font-semibold text-[#1a1e29] outline-none transition focus:border-[#253B80] disabled:opacity-50"
                >
                  <option value="">-- Chọn agent 1 --</option>
                  {Object.entries(byUser).map(([, list]) => (
                    <optgroup key={list[0].username} label={`@${list[0].username}`}>
                      {list.map((a) => (
                        <option key={a.id} value={a.id} disabled={a.id === agent2Id}>
                          {a.agent_name} (ELO {a.elo})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <span className="pb-2 text-xl font-black text-slate-400">VS</span>

              {/* Agent 2 */}
              <div className="min-w-[200px] flex-1">
                <p className="mb-1.5 font-bold text-xs text-rose-700">🟥 Player 2 (Đỏ)</p>
                <select
                  value={agent2Id}
                  onChange={(e) => setAgent2Id(e.target.value ? Number(e.target.value) : "")}
                  disabled={isRunning}
                  className="w-full rounded-none border border-[#ded8d3] bg-white px-3 py-2.5 text-sm font-semibold text-[#1a1e29] outline-none transition focus:border-rose-600 disabled:opacity-50"
                >
                  <option value="">-- Chọn agent 2 --</option>
                  {Object.entries(byUser).map(([, list]) => (
                    <optgroup key={list[0].username} label={`@${list[0].username}`}>
                      {list.map((a) => (
                        <option key={a.id} value={a.id} disabled={a.id === agent1Id}>
                          {a.agent_name} (ELO {a.elo})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Buttons */}
              <div className="pb-0.5">
                {!liveActive ? (
                  <button
                    onClick={startLive}
                    disabled={!agent1Id || !agent2Id || !!sameUser || agent1Id === agent2Id || backendOnline === false || backendOnline === null}
                    className="cursor-pointer rounded-none bg-[#253B80] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#1d2e66] disabled:cursor-not-allowed disabled:opacity-50"
                    title={backendOnline === false ? "Backend đang offline" : undefined}
                  >
                    {backendOnline === null ? "⏳ Đang kiểm tra..." : "⚔️ Bắt đầu đấu"}
                  </button>
                ) : (
                  <button
                    onClick={resetLive}
                    className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#253B80]"
                  >
                    ↩ Trận mới
                  </button>
                )}
              </div>
            </div>
          )}

          {sameUser && (
            <p className="mt-3 text-xs font-bold text-amber-700">⚠️ Hai agent phải thuộc hai người dùng khác nhau.</p>
          )}
          {error && <p className="mt-3 text-xs font-bold text-rose-700">❌ {error}</p>}
        </div>

        {/* Live match area */}
        {liveActive && (
          <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
            {/* Board */}
            <div className="rounded-none border border-[#ded8d3] bg-white p-5 shadow-md">
              {/* Player headers */}
              <div className="mb-4 flex justify-between gap-3">
                {[
                  { agent: liveAgent1, p: 1, label: "Player 1", color: "text-[#253B80]", border: "border-[#253B80] bg-[#253B80]/5" },
                  { agent: liveAgent2, p: 2, label: "Player 2", color: "text-rose-700", border: "border-rose-400 bg-rose-50" },
                ].map(({ agent, p, label, color, border }) => {
                  const c = pieceCounts[p];
                  return (
                    <div key={p} className={`rounded-none border p-3 flex-1 ${border}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`font-bold text-sm ${color}`}>{agent?.agent_name ?? `Agent ${p}`}</span>
                        <span className="text-[10px] font-bold uppercase text-slate-500">{label}</span>
                      </div>
                      <div className="flex gap-3 font-mono text-xs text-slate-700">
                        <span>✊ <span className="font-bold text-[#1a1e29]">{c.ROCK}</span></span>
                        <span>✋ <span className="font-bold text-[#1a1e29]">{c.PAPER}</span></span>
                        <span>✌️ <span className="font-bold text-[#1a1e29]">{c.SCISSORS}</span></span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Status bar */}
              <div className="mb-3 flex items-center justify-between border-b border-[#ded8d3] pb-2 text-xs">
                <div className="flex items-center gap-2">
                  {isRunning && (
                    <div className="h-2 w-2 animate-pulse bg-emerald-600 rounded-none" />
                  )}
                  <span className="font-bold text-slate-700">
                    {isRunning
                      ? `Đang thi đấu... Nước ${liveSteps.length}`
                      : liveDone
                      ? `Kết thúc · Tổng ${liveDone.total_moves} nước`
                      : liveError
                      ? "⚠️ Đã xảy ra lỗi"
                      : ""}
                  </span>
                </div>
                {liveDone && (
                  <Link
                    href={`/arena/replay/friendly/${liveDone.friendly_match_id}`}
                    className="rounded-none border border-[#253B80] px-3 py-1 text-xs font-bold text-[#253B80] hover:bg-[#253B80] hover:text-white transition"
                  >
                    ▶ Xem Replay đầy đủ
                  </Link>
                )}
              </div>

              {/* Winner banner */}
              {liveDone && outcomeLabel && (
                <div className="mb-4 rounded-none border border-amber-300 bg-amber-50 px-4 py-3 text-center">
                  <p className="text-lg font-bold text-amber-800">{outcomeLabel}</p>
                  {liveDone.win_reason && (
                    <p className="mt-0.5 text-xs text-slate-600">{liveDone.win_reason}</p>
                  )}
                </div>
              )}

              {liveError && (
                <div className="mb-4 rounded-none border border-rose-300 bg-rose-50 px-4 py-3 text-center">
                  <p className="text-sm font-bold text-rose-700">⚠️ {liveError}</p>
                </div>
              )}

              <div className="flex justify-center p-2 bg-[#F5F0ED]/60 border border-[#ded8d3]">
                <GameBoard board={liveBoard} lastMove={liveLastMove} />
              </div>
            </div>

            {/* Move log: Khung thẳng */}
            <div className="flex flex-col rounded-none border border-[#ded8d3] bg-white p-5 shadow-md">
              <div className="mb-3 flex items-center justify-between border-b border-[#ded8d3] pb-2">
                <h3 className="text-sm font-bold text-[#1a1e29]">📜 Nhật ký nước đi</h3>
                <span className="font-mono text-xs font-bold text-slate-500">{liveSteps.length} nước</span>
              </div>
              <div
                ref={moveLogRef}
                className="flex-1 space-y-1 overflow-y-auto pr-1"
                style={{ maxHeight: 480 }}
              >
                {liveSteps.length === 0 && (
                  <p className="py-8 text-center text-xs text-slate-400">Chờ trận đấu bắt đầu...</p>
                )}
                {liveSteps.map((s, i) => {
                  const pColor = s.player === 1 ? "text-[#253B80]" : "text-rose-700";
                  const isLast = i === liveSteps.length - 1;
                  return (
                    <div
                      key={s.step_number}
                      className={`rounded-none px-2 py-1 font-mono text-xs transition border ${
                        isLast
                          ? "border-[#253B80] bg-[#253B80]/10 font-bold"
                          : "border-transparent text-slate-700 hover:bg-stone-50"
                      }`}
                    >
                      <span className="inline-block w-6 text-slate-400">{s.step_number}.</span>
                      <span className={`${pColor} font-bold mr-1.5`}>P{s.player}</span>
                      {s.move ? (
                        <>
                          {s.move.from_pos} → {s.move.to_pos}
                          {s.captured_type && (
                            <span className="ml-1 text-amber-700 font-bold"> ×{PIECE_EMOJI[s.captured_type]}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-rose-600"> [lỗi]</span>
                      )}
                      {s.game_over && <span className="ml-1 font-bold text-amber-600"> ⚑</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Match history: Khung thẳng */}
        <div className="overflow-hidden rounded-none border border-[#ded8d3] bg-white shadow-md">
          <div className="flex items-center justify-between border-b border-[#ded8d3] bg-stone-50 px-5 py-4">
            <h2 className="text-sm font-bold text-[#1a1e29]">📋 Lịch sử các trận đối kháng gần đây</h2>
            <button
              onClick={loadMatches}
              className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-[#253B80]"
            >
              🔄 Làm mới
            </button>
          </div>

          {loadingMatches ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
            </div>
          ) : matches.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">Chưa có trận đối kháng nào.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#ded8d3] bg-stone-50 text-left text-xs font-bold text-slate-600">
                    <th className="px-4 py-3">Agent 1 🟦</th>
                    <th className="px-3 py-3 text-center">vs</th>
                    <th className="px-4 py-3">Agent 2 🟥</th>
                    <th className="px-4 py-3">Kết quả</th>
                    <th className="px-4 py-3 text-right">Nước</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3 text-right">Thời gian</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ded8d3]">
                  {matches.map((m) => (
                    <tr key={m.id} className="hover:bg-stone-50 transition">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/arena/agents/${m.agent1_id}`}
                          className="font-bold text-[#253B80] hover:underline"
                        >
                          {m.agent1_name}
                        </Link>
                        <p className="text-xs text-slate-500">@{m.agent1_username}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold text-xs text-slate-400">vs</td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/arena/agents/${m.agent2_id}`}
                          className="font-bold text-rose-700 hover:underline"
                        >
                          {m.agent2_name}
                        </Link>
                        <p className="text-xs text-slate-500">@{m.agent2_username}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {m.is_infra_error ? (
                          <span className="text-xs font-bold text-amber-700">⚠️ Lỗi</span>
                        ) : m.winner_name ? (
                          <span className="text-xs font-bold text-amber-800">🏆 {m.winner_name}</span>
                        ) : m.outcome === "draw" ? (
                          <span className="text-xs font-bold text-slate-600">🤝 Hòa</span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                        {m.total_moves}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-none border px-2 py-0.5 text-xs font-bold ${
                            STATUS_BADGE[m.status] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-sans text-xs text-slate-500">
                        {new Date(m.created_at).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {m.status === "finished" && !m.is_infra_error && (
                          <Link
                            href={`/arena/replay/friendly/${m.id}`}
                            className="rounded-none border border-[#253B80] px-2.5 py-1 text-xs font-bold text-[#253B80] hover:bg-[#253B80] hover:text-white transition"
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
      </main>
    </div>
  );
}
