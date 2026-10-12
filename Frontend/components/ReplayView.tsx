"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { GameBoard, applyMove, flattenBoard, getPieceCounts, PIECE_EMOJI, type Piece } from "@/components/GameBoard";

type MoveEntry = {
  move_number: number; player: number;
  from_col: number; from_row: number; to_col: number; to_row: number;
  from_pos: string; to_pos: string;
  piece_type: string | null; captured_type: string | null;
};

type ReplayMatch = {
  id: number; status: string; outcome: string | null; win_reason: string;
  total_moves: number; is_infra_error: boolean;
  agent1_id: number; agent1_name: string; agent1_username: string;
  agent2_id: number; agent2_name: string; agent2_username: string;
  winner_name: string | null; session_name?: string;
  elo_delta_agent1?: number | null; elo_delta_agent2?: number | null;
  finished_at: string | null;
};

type ReplayData = {
  match: ReplayMatch;
  moves: MoveEntry[];
  initial_board: (Piece | null)[][];
};

export default function ReplayView({
  apiUrl,
  backLink,
  backLabel = "← Quay lại",
}: {
  apiUrl: string;
  backLink: string;
  backLabel?: string;
}) {
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState("");
  const [currentStep, setCurrentStep] = useState(0); // 0 = initial board
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(apiUrl)
      .then(r => r.json())
      .then((d: ReplayData | { error: string }) => {
        if ("error" in d) { setError(d.error); return; }
        setData(d);
      })
      .catch(() => setError("Không thể tải replay."));
  }, [apiUrl]);

  // Compute board states lazily
  const boardStates = useRef<Piece[][]>([]);
  useEffect(() => {
    if (!data) return;
    const flat0 = flattenBoard(data.initial_board as Piece[][]);
    const states: Piece[][] = [flat0];
    let current = flat0;
    for (const mv of data.moves) {
      current = applyMove(current, mv);
      states.push(current);
    }
    boardStates.current = states;
  }, [data]);

  const totalSteps = data?.moves.length ?? 0;
  const currentBoard = boardStates.current[currentStep] ?? (data ? flattenBoard(data.initial_board as Piece[][]) : Array(81).fill(null));
  const currentMove = currentStep > 0 ? data?.moves[currentStep - 1] : null;
  const pieceCounts = getPieceCounts(currentBoard);

  const stepTo = useCallback((step: number) => {
    setCurrentStep(Math.max(0, Math.min(step, totalSteps)));
  }, [totalSteps]);

  // Auto-play
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentStep(prev => {
          if (prev >= totalSteps) { setPlaying(false); return prev; }
          return prev + 1;
        });
      }, speed);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, speed, totalSteps]);

  if (error) return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-rose-300 mb-4">⚠️ {error}</p>
        <Link href={backLink} className="text-sm text-slate-400 hover:text-white">{backLabel}</Link>
      </div>
    </main>
  );

  if (!data) return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
    </main>
  );

  const { match, moves } = data;
  const isGameOver = currentStep === totalSteps && totalSteps > 0;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href={backLink} className="text-sm text-slate-400 hover:text-white">{backLabel}</Link>
        </div>

        {/* Match header */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="font-bold text-blue-300 text-lg">{match.agent1_name}</p>
                <p className="text-xs text-slate-500">{match.agent1_username}</p>
                {match.elo_delta_agent1 != null && (
                  <p className={`text-xs font-mono ${match.elo_delta_agent1 >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {match.elo_delta_agent1 >= 0 ? "+" : ""}{match.elo_delta_agent1} ELO
                  </p>
                )}
              </div>
              <span className="text-2xl font-black text-slate-600">VS</span>
              <div className="text-center">
                <p className="font-bold text-rose-300 text-lg">{match.agent2_name}</p>
                <p className="text-xs text-slate-500">{match.agent2_username}</p>
                {match.elo_delta_agent2 != null && (
                  <p className={`text-xs font-mono ${match.elo_delta_agent2 >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {match.elo_delta_agent2 >= 0 ? "+" : ""}{match.elo_delta_agent2} ELO
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              {match.outcome && (
                <p className="text-yellow-300 font-bold text-lg">
                  🏆 {match.winner_name ?? "Hòa"}
                </p>
              )}
              {match.is_infra_error && <p className="text-rose-400 text-sm">⚠️ Lỗi hạ tầng</p>}
              <p className="text-xs text-slate-500 mt-1">{match.win_reason}</p>
              <p className="text-xs text-slate-600">{totalSteps} nước · {match.session_name ?? "Friendly"}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
          {/* Board + controls */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            {/* Piece counts */}
            <div className="mb-3 grid grid-cols-2 gap-2">
              {([2, 1] as const).map(p => {
                const c = pieceCounts[p];
                const isP1 = p === 1;
                const color = isP1
                  ? "border-blue-400/30 bg-blue-400/5 text-blue-200"
                  : "border-rose-400/30 bg-rose-400/5 text-rose-200";
                return (
                  <div key={p} className={`rounded-xl border p-2.5 text-xs ${color}`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className={`h-2.5 w-2.5 rounded-full ${isP1 ? "bg-blue-400" : "bg-rose-400"}`} />
                      <span className="font-semibold text-sm">
                        {isP1 ? "Người chơi 1 (Xanh)" : "Người chơi 2 (Đỏ)"}
                      </span>
                    </div>
                    <div className="flex gap-2 font-mono">
                      <span>✊ <span className="text-yellow-300 font-bold">{c.ROCK}/3</span></span>
                      <span>✋ <span className="text-yellow-300 font-bold">{c.PAPER}/4</span></span>
                      <span>✌️ <span className="text-yellow-300 font-bold">{c.SCISSORS}/3</span></span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Winner overlay */}
            {isGameOver && match.outcome && (
              <div className="mb-3 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-2 text-center">
                <p className="font-bold text-yellow-300">
                  {match.winner_name ? `🏆 ${match.winner_name} thắng!` : "🤝 Hòa!"}
                </p>
              </div>
            )}

            <GameBoard board={currentBoard} lastMove={currentMove} />

            {/* Playback controls */}
            <div className="mt-4 space-y-3">
              {/* Step slider */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-14 text-right font-mono">
                  {currentStep}/{totalSteps}
                </span>
                <input
                  type="range" min={0} max={totalSteps} value={currentStep}
                  onChange={e => { setPlaying(false); stepTo(Number(e.target.value)); }}
                  className="flex-1 accent-indigo-400"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button onClick={() => { setPlaying(false); stepTo(0); }}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5 transition" title="Đầu">|◀</button>
                <button onClick={() => { setPlaying(false); stepTo(currentStep - 1); }}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5 transition" title="Lùi">◀ Lùi</button>
                <button
                  onClick={() => setPlaying(p => { if (p) return false; if (currentStep >= totalSteps) stepTo(0); return true; })}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${playing ? "bg-rose-500/30 border border-rose-400/30 text-rose-200" : "bg-indigo-500/30 border border-indigo-400/30 text-indigo-200"}`}
                >
                  {playing ? "⏸ Dừng" : "▶ Chạy"}
                </button>
                <button onClick={() => { setPlaying(false); stepTo(currentStep + 1); }}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5 transition" title="Tiến">Tiến ▶</button>
                <button onClick={() => { setPlaying(false); stepTo(totalSteps); }}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5 transition" title="Cuối">▶|</button>
              </div>

              {/* Speed */}
              <div className="flex items-center gap-3 justify-center text-xs text-slate-500">
                <span>Chậm</span>
                <input type="range" min={100} max={2000} step={100} value={speed}
                  onChange={e => setSpeed(Number(e.target.value))}
                  className="w-32 accent-indigo-400" />
                <span>Nhanh</span>
                <span className="font-mono text-slate-400 w-16">{speed}ms/nước</span>
              </div>
            </div>
          </div>

          {/* Move log */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <h3 className="mb-3 font-semibold text-slate-200 text-sm">📜 Lịch sử nước đi</h3>
            <div className="h-[460px] overflow-y-auto space-y-0.5 pr-1">
              {moves.map((mv, i) => {
                const step = i + 1;
                const isActive = step === currentStep;
                const pColor = mv.player === 1 ? "text-blue-400" : "text-rose-400";
                return (
                  <button
                    key={mv.move_number}
                    onClick={() => { setPlaying(false); stepTo(step); }}
                    className={`w-full text-left rounded px-2 py-1 text-xs transition font-mono ${isActive ? "bg-indigo-400/20 text-white" : "hover:bg-white/5 text-slate-400"}`}
                  >
                    <span className="text-slate-600 w-6 inline-block">{step}.</span>
                    <span className={`${pColor} font-semibold`}>P{mv.player}</span>
                    {" "}{mv.from_pos}→{mv.to_pos}
                    {mv.captured_type && <span className="text-yellow-400"> ×{PIECE_EMOJI[mv.captured_type]}</span>}
                  </button>
                );
              })}
              {moves.length === 0 && <p className="text-slate-600 text-xs text-center py-8">Chưa có nước đi nào.</p>}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
