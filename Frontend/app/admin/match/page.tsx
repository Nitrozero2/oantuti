"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import { GameBoard, type Piece } from "@/components/GameBoard";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import type { MatchState, StepResult } from "@/lib/api";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

// ─── Built-in agent presets ────────────────────────────────────────────────
const RANDOM_AGENT = `import random

def agent(observation, configuration):
    moves = observation.get("valid_moves", [])
    if not moves:
        return None
    move = random.choice(moves)
    return {
        "from_col": move["from_col"],
        "from_row": move["from_row"],
        "to_col": move["to_col"],
        "to_row": move["to_row"],
    }
`;

const GREEDY_AGENT = `import random, math

def agent(observation, configuration):
    moves = observation.get("valid_moves", [])
    if not moves:
        return None

    current_player = observation.get("current_player", 1)
    board = observation.get("board", [])
    piece_counts = observation.get("piece_counts", {})

    target_col = 8 if current_player == 1 else 0
    target_row = 8 if current_player == 1 else 0
    opponent = 2 if current_player == 1 else 1

    def get_cell(col, row):
        if 0 <= col < 9 and 0 <= row < 9:
            return board[row * 9 + col]
        return None

    BEATS = {"ROCK": "SCISSORS", "PAPER": "ROCK", "SCISSORS": "PAPER"}
    DIRECTIONS = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]

    def score_move(move):
        fc, fr = move["from_col"], move["from_row"]
        tc, tr = move["to_col"], move["to_row"]
        is_capture = move.get("is_capture", False)
        piece = get_cell(fc, fr)
        s = 0.0
        if current_player == 1 and tc == 8 and tr == 8: s += 100000
        if current_player == 2 and tc == 0 and tr == 0: s += 100000
        if is_capture:
            s += 120
            target_piece = get_cell(tc, tr)
            if target_piece:
                opp_counts = piece_counts.get(str(opponent), piece_counts.get(opponent, {}))
                if opp_counts.get(target_piece["type"], 0) == 1:
                    s += 50000
        current_dist = math.hypot(fc - target_col, fr - target_row)
        new_dist = math.hypot(tc - target_col, tr - target_row)
        s += (current_dist - new_dist) * 15
        if piece:
            for dc, dr in DIRECTIONS:
                nb = get_cell(tc + dc, tr + dr)
                if nb and nb["player"] == opponent:
                    if BEATS.get(nb["type"]) == piece["type"]:
                        s -= 80
                        break
        s += random.random() * 5
        return s

    return {k: max(moves, key=score_move)[k]
            for k in ("from_col","from_row","to_col","to_row")}
`;

const PRESETS: Record<string, { label: string; code: string; emoji: string }> = {
  random: { label: "Random Agent", code: RANDOM_AGENT, emoji: "🎲" },
  greedy: { label: "Greedy Agent", code: GREEDY_AGENT, emoji: "🧠" },
  custom: { label: "Custom Code", code: RANDOM_AGENT, emoji: "✏️" },
};

type AgentKey = "random" | "greedy" | "custom";

// ─── Main page ──────────────────────────────────────────────────────────────
export default function AdminMatchPage() {
  const [agent1Key, setAgent1Key] = useState<AgentKey>("random");
  const [agent2Key, setAgent2Key] = useState<AgentKey>("greedy");
  const [agent1Code, setAgent1Code] = useState(RANDOM_AGENT);
  const [agent2Code, setAgent2Code] = useState(GREEDY_AGENT);
  const [maxMoves, setMaxMoves] = useState(200);

  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [lastStep, setLastStep] = useState<StepResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoDelay, setAutoDelay] = useState(500);
  const [error, setError] = useState("");

  const autoRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const BACKEND_URL =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
      : "http://localhost:8000";

  function addLog(msg: string) {
    setLog((prev) => [...prev.slice(-199), msg]);
  }

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  function handleAgentSelect(player: 1 | 2, key: AgentKey) {
    if (player === 1) {
      setAgent1Key(key);
      if (key !== "custom") setAgent1Code(PRESETS[key].code);
    } else {
      setAgent2Key(key);
      if (key !== "custom") setAgent2Code(PRESETS[key].code);
    }
  }

  async function createMatch() {
    setError("");
    setBusy(true);
    setMatchId(null);
    setMatchState(null);
    setLastStep(null);
    setLog([]);
    try {
      const res = await fetch(`${BACKEND_URL}/matches/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent1_code: agent1Code,
          agent2_code: agent2Code,
          max_moves: maxMoves,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? "Tạo trận thất bại");
        return;
      }
      setMatchId(data.match_id);
      addLog(`✅ Tạo trận ${data.match_id} thành công`);
      await loadState(data.match_id);
    } catch {
      setError("Không thể kết nối backend. Đảm bảo FastAPI đang chạy tại " + BACKEND_URL);
    } finally {
      setBusy(false);
    }
  }

  async function loadState(id: string) {
    const res = await fetch(`${BACKEND_URL}/matches/${id}`);
    if (res.ok) {
      const data = await res.json();
      setMatchState(data as MatchState);
    }
  }

  const stepOnce = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await fetch(`${BACKEND_URL}/matches/${id}/step`, {
        method: "POST",
      });
      const data: StepResult = await res.json();
      setLastStep(data);
      await loadState(id);
      const playerLabel = `P${data.player}`;
      if (data.error) {
        addLog(`❌ ${playerLabel} lỗi: ${data.error}`);
      } else if (data.move) {
        const capture = data.captured
          ? ` (ăn ${data.captured.type} P${data.captured.player})`
          : "";
        addLog(
          `🎯 Nước ${data.step_number} · ${playerLabel}: ${data.move.from_pos}→${data.move.to_pos}${capture}`,
        );
      }
      if (data.game_over) {
        const winner = data.winner ? `P${data.winner} thắng` : "Hòa";
        addLog(`🏁 Kết thúc! ${winner}. Lý do: ${data.win_reason || "—"}`);
      }
      return data.game_over;
    },
    [BACKEND_URL],
  );

  async function handleStep() {
    if (!matchId) return;
    setBusy(true);
    try {
      await stepOnce(matchId);
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoRun() {
    if (!matchId) return;
    autoRef.current = true;
    setAutoRunning(true);
    setBusy(true);

    try {
      let done = false;
      while (!done && autoRef.current) {
        done = await stepOnce(matchId);
        if (!done && autoRef.current) {
          await new Promise((r) => setTimeout(r, autoDelay));
        }
      }
    } finally {
      autoRef.current = false;
      setAutoRunning(false);
      setBusy(false);
    }
  }

  function handleStop() {
    autoRef.current = false;
    setAutoRunning(false);
  }

  async function handleDelete() {
    if (!matchId) return;
    await fetch(`${BACKEND_URL}/matches/${matchId}`, { method: "DELETE" });
    setMatchId(null);
    setMatchState(null);
    setLastStep(null);
    setLog([]);
    addLog("🗑️ Đã xóa trận đấu.");
  }

  const gameOver = matchState?.game_over ?? false;
  const pieceCountsRaw = matchState?.piece_counts ?? {};

  function getPieceCounts(player: 1 | 2) {
    const key = String(player);
    const counts = pieceCountsRaw[key] ?? pieceCountsRaw[player] ?? {};
    return {
      ROCK: counts.ROCK ?? 0,
      PAPER: counts.PAPER ?? 0,
      SCISSORS: counts.SCISSORS ?? 0,
    };
  }

  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb & Admin tag */}
        <div className="mb-6 flex items-center justify-between border-b border-[#ded8d3] pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Link href="/dashboard" className="hover:text-[#253B80]">Dashboard</Link>
            <span>/</span>
            <Link href="/admin/tournament" className="hover:text-[#253B80]">Tournament</Link>
            <span>/</span>
            <Link href="/admin/matches" className="hover:text-[#253B80]">Danh sách trận</Link>
            <span>/</span>
            <span className="text-[#1a1e29]">Trận trực tiếp</span>
          </div>
          <span className="rounded-none border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
            Admin Area
          </span>
        </div>

        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-[#1a1e29] sm:text-4xl">⚔️ Tạo & Xem Trận Đấu</h1>
          <p className="mt-1 text-sm text-slate-600">
            Chọn 2 agent AI, cài đặt thông số và chạy trận đấu OTTv2 trực tiếp.
          </p>
        </div>

        {/* ── 2 Agents Config ── */}
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
          {/* Agent 1 config */}
          <AgentConfig
            player={1}
            agentKey={agent1Key}
            code={agent1Code}
            onSelectPreset={(k) => handleAgentSelect(1, k)}
            onCodeChange={setAgent1Code}
          />

          {/* VS Divider */}
          <div className="flex items-center justify-center">
            <span className="rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-sm font-black text-slate-400 shadow-sm">
              VS
            </span>
          </div>

          {/* Agent 2 config */}
          <AgentConfig
            player={2}
            agentKey={agent2Key}
            code={agent2Code}
            onSelectPreset={(k) => handleAgentSelect(2, k)}
            onCodeChange={setAgent2Code}
          />
        </div>

        {/* ── Match settings ── */}
        <div className="mt-6 rounded-none border border-[#ded8d3] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#1a1e29]">
              Số nước tối đa
              <input
                type="number"
                min={10}
                max={1000}
                value={maxMoves}
                onChange={(e) => setMaxMoves(Number(e.target.value))}
                className="w-28 rounded-none border border-[#ded8d3] bg-[#F5F0ED] px-3 py-2 text-[#1a1e29] outline-none focus:border-[#253B80]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#1a1e29]">
              Delay auto-run (ms)
              <input
                type="number"
                min={0}
                max={5000}
                step={100}
                value={autoDelay}
                onChange={(e) => setAutoDelay(Number(e.target.value))}
                className="w-28 rounded-none border border-[#ded8d3] bg-[#F5F0ED] px-3 py-2 text-[#1a1e29] outline-none focus:border-[#253B80]"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={createMatch}
                disabled={busy}
                className="rounded-none bg-[#253B80] px-5 py-2.5 font-semibold text-white transition hover:bg-[#1d2e66] disabled:opacity-60 cursor-pointer"
              >
                {busy && !autoRunning ? "Đang tạo..." : "🆕 Tạo trận"}
              </button>

              {matchId && !gameOver && !autoRunning && (
                <button
                  onClick={handleStep}
                  disabled={busy}
                  className="rounded-none bg-emerald-600 px-5 py-2.5 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                >
                  ▶ Nước tiếp
                </button>
              )}

              {matchId && !gameOver && !autoRunning && (
                <button
                  onClick={handleAutoRun}
                  disabled={busy}
                  className="rounded-none bg-amber-600 px-5 py-2.5 font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60 cursor-pointer"
                >
                  ⚡ Auto-run
                </button>
              )}

              {autoRunning && (
                <button
                  onClick={handleStop}
                  className="rounded-none bg-rose-600 px-5 py-2.5 font-semibold text-white transition hover:bg-rose-700 cursor-pointer"
                >
                  ⏹ Dừng
                </button>
              )}

              {matchId && (
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="rounded-none border border-rose-300 bg-rose-50 px-5 py-2.5 font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60 cursor-pointer"
                >
                  🗑 Xóa
                </button>
              )}
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-none border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">
              {error}
            </p>
          )}
        </div>

        {/* ── Live battle area ── */}
        {matchId && matchState && (
          <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
            {/* Board */}
            <div className="rounded-none border border-[#ded8d3] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-[#ded8d3] pb-3">
                <h2 className="font-bold text-[#1a1e29]">
                  🎮 Bàn cờ — Trận{" "}
                  <span className="font-mono text-[#253B80]">{matchId}</span>
                </h2>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-slate-600">
                    Nước: <span className="font-mono font-bold text-[#1a1e29]">{matchState.move_count}</span>
                  </span>
                  {!gameOver && (
                    <span className="rounded-none border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">
                      Lượt P{matchState.current_turn}
                    </span>
                  )}
                  {gameOver && (
                    <span className="rounded-none border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
                      Kết thúc
                    </span>
                  )}
                </div>
              </div>

              {/* Winner banner */}
              {gameOver && (
                <div className="mb-4 rounded-none border border-amber-300 bg-amber-50 px-4 py-3 text-center">
                  <p className="text-xl font-extrabold text-amber-900">
                    {matchState.winner ? `🏆 Player ${matchState.winner} thắng!` : "🤝 Hòa!"}
                  </p>
                  <p className="mt-1 text-sm text-amber-800">{matchState.win_reason}</p>
                </div>
              )}

              {/* Piece counts */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                {([1, 2] as const).map((p) => {
                  const counts = getPieceCounts(p);
                  const colorClass =
                    p === 1 ? "border-[#253B80]/30 bg-[#253B80]/5" : "border-[#b91c1c]/30 bg-[#b91c1c]/5";
                  const textColor = p === 1 ? "text-[#253B80]" : "text-[#b91c1c]";
                  return (
                    <div key={p} className={`rounded-none border p-3 ${colorClass}`}>
                      <p className={`mb-2 text-xs font-bold ${textColor}`}>
                        Player {p} {p === 1 ? "(Xanh, đi trước)" : "(Đỏ)"}
                      </p>
                      <div className="flex gap-3 text-sm font-semibold text-[#1a1e29]">
                        <span>✊ {counts.ROCK}</span>
                        <span>✋ {counts.PAPER}</span>
                        <span>✌️ {counts.SCISSORS}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-center p-2">
                <GameBoard
                  board={matchState.board as Piece[]}
                  lastMove={lastStep?.move ?? null}
                />
              </div>
            </div>

            {/* Log */}
            <div className="rounded-none border border-[#ded8d3] bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-bold text-[#1a1e29]">📜 Nhật ký nước đi</h2>
              <div
                ref={logRef}
                className="h-[520px] overflow-y-auto space-y-1 rounded-none border border-[#ded8d3] bg-[#F5F0ED] p-3 font-mono text-xs text-[#1a1e29]"
              >
                {log.length === 0 && (
                  <p className="text-slate-500 py-4 text-center">Chưa có nước đi nào.</p>
                )}
                {log.map((line, i) => (
                  <div key={i} className="leading-5">
                    {line}
                  </div>
                ))}
              </div>

              {/* Last step detail */}
              {lastStep?.agent_stdout && (
                <div className="mt-4 rounded-none border border-[#ded8d3] bg-[#eae4df] p-3">
                  <p className="mb-1 text-xs font-bold text-slate-600">Agent stdout:</p>
                  <pre className="text-xs text-[#1a1e29] overflow-x-auto whitespace-pre-wrap break-words font-mono">
                    {lastStep.agent_stdout}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── AgentConfig sub-component ────────────────────────────────────────────────
function AgentConfig({
  player,
  agentKey,
  code,
  onSelectPreset,
  onCodeChange,
}: {
  player: 1 | 2;
  agentKey: string;
  code: string;
  onSelectPreset: (k: AgentKey) => void;
  onCodeChange: (c: string) => void;
}) {
  const isP1 = player === 1;
  const borderAccent = isP1 ? "border-l-4 border-l-[#253B80]" : "border-l-4 border-l-[#b91c1c]";
  const accentText = isP1 ? "text-[#253B80]" : "text-[#b91c1c]";

  return (
    <div className={`rounded-none border border-[#ded8d3] bg-white p-5 shadow-sm ${borderAccent}`}>
      <div className="mb-4 flex items-center justify-between">
        <p className={`text-base font-bold ${accentText}`}>
          Player {player} {isP1 ? "(Xanh · Điểm xuất phát i9)" : "(Đỏ · Điểm xuất phát a1)"}
        </p>
        <span className="text-xs font-mono text-slate-500">Python 3.10</span>
      </div>

      {/* Preset selector */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {(Object.keys(PRESETS) as AgentKey[]).map((k) => (
          <button
            key={k}
            onClick={() => onSelectPreset(k)}
            className={`rounded-none border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              agentKey === k
                ? isP1
                  ? "border-[#253B80] bg-[#253B80] text-white font-bold"
                  : "border-[#b91c1c] bg-[#b91c1c] text-white font-bold"
                : "border-[#ded8d3] bg-[#F5F0ED] text-[#1a1e29] hover:bg-[#eae4df]"
            }`}
          >
            {PRESETS[k].emoji} {PRESETS[k].label}
          </button>
        ))}
      </div>

      {/* Code editor */}
      <div className="rounded-none overflow-hidden border border-[#ded8d3]">
        <CodeMirror
          value={code}
          height="280px"
          extensions={[python()]}
          theme={oneDark}
          onChange={(val) => {
            onCodeChange(val);
            if (agentKey !== "custom") onSelectPreset("custom");
          }}
          basicSetup={{
            lineNumbers: true,
            syntaxHighlighting: true,
            autocompletion: true,
          }}
        />
      </div>
    </div>
  );
}
