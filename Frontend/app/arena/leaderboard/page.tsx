"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type LeaderboardEntry = {
  agent_id: number; agent_name: string; description: string; username: string;
  version: number; elo: number; wins: number; losses: number; draws: number;
  error_matches: number; total_games: number; win_rate: number; submitted_at: string;
};

type TournamentMatch = {
  id: number; session_id: number; status: string; outcome: string | null;
  win_reason: string; total_moves: number; is_infra_error: boolean;
  elo_delta_agent1: number | null; elo_delta_agent2: number | null;
  scheduled_at: string; finished_at: string | null;
  agent1_id: number; agent1_name: string; agent1_username: string;
  agent2_id: number; agent2_name: string; agent2_username: string;
  winner_name: string | null; session_name: string | null;
};

type Session = {
  id: number; name: string; status: string; config: Record<string, unknown>;
  created_at: string; started_at: string | null; completed_at: string | null;
  total_matches: number; scheduled_matches: number; finished_matches: number; error_matches: number;
};

const MEDALS = ["🥇","🥈","🥉"];

function getTier(elo: number) {
  if (elo >= 2000) return { label: "Grandmaster", color: "text-amber-300", bar: "bg-amber-400", emoji: "👑" };
  if (elo >= 1800) return { label: "Master",      color: "text-violet-300", bar: "bg-violet-400", emoji: "💎" };
  if (elo >= 1600) return { label: "Expert",       color: "text-blue-300",   bar: "bg-blue-400",   emoji: "🔷" };
  if (elo >= 1400) return { label: "Intermediate", color: "text-teal-300",   bar: "bg-teal-400",   emoji: "🟢" };
  return                  { label: "Novice",       color: "text-slate-400",  bar: "bg-slate-500",  emoji: "⚪" };
}

function EloBar({ elo }: { elo: number }) {
  const pct = Math.min(100, Math.max(0, ((elo - 800) / (2200 - 800)) * 100));
  const tier = getTier(elo);
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="h-1 w-16 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${tier.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  idle: "bg-slate-400/20 text-slate-300",
  running: "bg-emerald-400/20 text-emerald-300",
  paused: "bg-yellow-400/20 text-yellow-300",
  stopped: "bg-rose-400/20 text-rose-300",
  completed: "bg-indigo-400/20 text-indigo-300",
};

export default function ArenaLeaderboardPage() {
  const [tab, setTab] = useState<"rankings"|"matches"|"sessions">("rankings");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [matches, setMatches] = useState<TournamentMatch[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionFilter, setSessionFilter] = useState<string>("");
  const [error, setError] = useState("");
  const router = useRouter();

  // Load leaderboard
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/arena/leaderboard");
        if (res.status === 401) { router.push("/login"); return; }
        const data = await res.json() as { leaderboard?: LeaderboardEntry[]; error?: string };
        if (data.error) { setError(data.error); return; }
        setLeaderboard(data.leaderboard ?? []);
      } catch { setError("Không thể kết nối máy chủ."); }
    }
    load();
  }, [router]);

  // Load sessions whenever sessions tab is opened or matches tab needs the dropdown
  useEffect(() => {
    if (tab === "sessions" || tab === "matches") {
      if (sessions !== null) return;
      fetch("/api/tournament/sessions")
        .then(r => r.ok ? r.json() : null)
        .then((d: { sessions?: Session[] } | null) => {
          if (d) setSessions(d.sessions ?? []);
        })
        .catch(() => {});
    }
  }, [tab, sessions]);

  // Load matches whenever tab=matches OR sessionFilter changes — always refetch
  useEffect(() => {
    if (tab !== "matches") return;
    setMatches(null);
    const url = sessionFilter
      ? `/api/tournament/matches?session_id=${sessionFilter}`
      : "/api/tournament/matches";
    fetch(url)
      .then(r => r.json())
      .then((d: { matches?: TournamentMatch[] }) => setMatches(d.matches ?? []))
      .catch(() => setMatches([]));
  }, [tab, sessionFilter]);

  function reloadMatches() {
    setMatches(null);
    const url = sessionFilter
      ? `/api/tournament/matches?session_id=${sessionFilter}`
      : "/api/tournament/matches";
    fetch(url)
      .then(r => r.json())
      .then((d: { matches?: TournamentMatch[] }) => setMatches(d.matches ?? []))
      .catch(() => setMatches([]));
  }

  function reloadLeaderboard() {
    setLeaderboard(null);
    fetch("/api/arena/leaderboard")
      .then(r => r.json())
      .then((d: { leaderboard?: LeaderboardEntry[] }) => setLeaderboard(d.leaderboard ?? []))
      .catch(() => setLeaderboard([]));
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">← Dashboard</Link>
        </div>

        {/* Hero */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">🏆 OTTv2 Arena</h1>
            <p className="mt-1 text-slate-400">Bảng xếp hạng AI agent theo ELO — Kaggle ConnectX style.</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/arena/submit" className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 transition">+ Nộp agent</Link>
            <Link href="/arena/friendly" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5 transition">⚔️ Đấu thử</Link>
            {tab === "rankings" && (
              <button onClick={reloadLeaderboard} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5 transition">🔄</button>
            )}
          </div>
        </div>

        {/* Tier legend */}
        <div className="mb-5 flex flex-wrap gap-2">
          {[{emoji:"👑",label:"Grandmaster",min:2000,c:"text-amber-300"},{emoji:"💎",label:"Master",min:1800,c:"text-violet-300"},{emoji:"🔷",label:"Expert",min:1600,c:"text-blue-300"},{emoji:"🟢",label:"Intermediate",min:1400,c:"text-teal-300"},{emoji:"⚪",label:"Novice",min:0,c:"text-slate-400"}].map(t => (
            <span key={t.label} className={`rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium ${t.c}`}>
              {t.emoji} {t.label} {t.min > 0 ? `≥${t.min}` : "<1400"}
            </span>
          ))}
        </div>

        {/* Tabs */}
        <div className="mb-5 flex gap-1 rounded-xl border border-white/10 bg-black/20 p-1 w-fit">
          {(["rankings","matches","sessions"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab===t ? "bg-indigo-500/30 text-indigo-200" : "text-slate-400 hover:text-white"}`}>
              {t === "rankings" ? "📊 Xếp hạng" : t === "matches" ? "📋 Lịch sử trận" : "🎯 Sessions"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {error}<br/>
            <span className="text-xs text-rose-400">Cần chạy tournament_schema.sql trong Neon console.</span>
          </div>
        )}

        {/* ── Rankings ── */}
        {tab === "rankings" && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] shadow-xl overflow-hidden">
            {leaderboard === null && !error && (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
              </div>
            )}
            {leaderboard !== null && leaderboard.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-4xl mb-3">🤖</p>
                <p className="text-slate-400 mb-4">Chưa có agent nào trong arena.</p>
                <Link href="/arena/submit" className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 transition">
                  Nộp agent đầu tiên
                </Link>
              </div>
            )}
            {leaderboard !== null && leaderboard.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                      <th className="px-4 py-3 font-medium">#</th>
                      <th className="px-4 py-3 font-medium">Agent</th>
                      <th className="px-4 py-3 font-medium">Tier</th>
                      <th className="px-4 py-3 text-right font-medium">ELO</th>
                      <th className="px-4 py-3 text-right font-medium">W / L / D</th>
                      <th className="px-4 py-3 text-right font-medium">Win%</th>
                      <th className="px-4 py-3 text-right font-medium">Trận</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {leaderboard.map((e, i) => {
                      const tier = getTier(e.elo);
                      return (
                        <tr key={e.agent_id} className={`hover:bg-white/[0.02] ${i < 3 ? "bg-white/[0.01]" : ""}`}>
                          <td className="px-4 py-3 text-slate-400">
                            {i < 3 ? <span className="text-base">{MEDALS[i]}</span> : <span className="font-mono text-xs">{i+1}</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Link href={`/arena/agents/${e.agent_id}`} className="font-semibold text-white hover:text-indigo-300 transition">
                              {e.agent_name}
                            </Link>
                            <span className="ml-1.5 text-xs text-slate-500">v{e.version}</span>
                            <span className="ml-1.5 text-xs text-slate-500">· {e.username}</span>
                            {e.description && <p className="text-xs text-slate-600 truncate max-w-[180px]">{e.description}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium ${tier.color}`}>{tier.emoji} {tier.label}</span>
                            <EloBar elo={e.elo} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-mono font-bold text-base ${tier.color}`}>{e.elo}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            <span className="text-emerald-400">{e.wins}</span>
                            <span className="text-slate-600"> / </span>
                            <span className="text-rose-400">{e.losses}</span>
                            <span className="text-slate-600"> / </span>
                            <span className="text-slate-400">{e.draws}</span>
                            {e.error_matches > 0 && <span className="text-orange-400 ml-1">⚠️{e.error_matches}</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {e.total_games > 0 ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="h-1 w-12 rounded-full bg-white/10 overflow-hidden">
                                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${e.win_rate}%` }} />
                                </div>
                                <span className="font-mono text-xs text-emerald-300 w-10 text-right">{e.win_rate}%</span>
                              </div>
                            ) : <span className="text-xs text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-400">{e.total_games}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Match history ── */}
        {tab === "matches" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-300">
                <option value="">Tất cả sessions</option>
                {(sessions ?? []).map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </select>
              <button onClick={reloadMatches} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 transition">🔄 Làm mới</button>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] shadow-xl overflow-hidden">
              {matches === null ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
                </div>
              ) : matches.length === 0 ? (
                <p className="py-12 text-center text-slate-500">Chưa có trận đấu nào.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs text-slate-500 text-left">
                        <th className="px-4 py-3 font-medium">Agent 1</th>
                        <th className="px-3 py-3 font-medium text-center">vs</th>
                        <th className="px-4 py-3 font-medium">Agent 2</th>
                        <th className="px-4 py-3 font-medium">Kết quả</th>
                        <th className="px-4 py-3 text-right font-medium">Nước</th>
                        <th className="px-4 py-3 font-medium">ELO ±</th>
                        <th className="px-4 py-3 text-right font-medium">Ngày</th>
                        <th className="px-4 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {matches.map(m => (
                        <tr key={m.id} className={`hover:bg-white/[0.02] ${m.is_infra_error ? "opacity-60" : ""}`}>
                          <td className="px-4 py-2.5">
                            <Link href={`/arena/agents/${m.agent1_id}`} className="font-medium text-blue-200 hover:text-blue-300">{m.agent1_name}</Link>
                            <p className="text-xs text-slate-500">{m.agent1_username}</p>
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs text-slate-600 font-bold">vs</td>
                          <td className="px-4 py-2.5">
                            <Link href={`/arena/agents/${m.agent2_id}`} className="font-medium text-rose-200 hover:text-rose-300">{m.agent2_name}</Link>
                            <p className="text-xs text-slate-500">{m.agent2_username}</p>
                          </td>
                          <td className="px-4 py-2.5">
                            {m.is_infra_error ? <span className="text-orange-400 text-xs">⚠️ Lỗi hạ tầng</span>
                              : m.winner_name ? <span className="font-semibold text-yellow-300 text-xs">🏆 {m.winner_name}</span>
                              : m.outcome === "draw" ? <span className="text-slate-400 text-xs">Hòa</span>
                              : <span className="text-slate-500 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-400">{m.total_moves}</td>
                          <td className="px-4 py-2.5 text-xs font-mono">
                            {!m.is_infra_error && m.elo_delta_agent1 != null && (
                              <span>
                                <span className={m.elo_delta_agent1 >= 0 ? "text-emerald-400" : "text-rose-400"}>{m.elo_delta_agent1 >= 0 ? "+" : ""}{m.elo_delta_agent1}</span>
                                <span className="text-slate-600"> / </span>
                                <span className={m.elo_delta_agent2 != null && m.elo_delta_agent2 >= 0 ? "text-emerald-400" : "text-rose-400"}>{m.elo_delta_agent2 != null && m.elo_delta_agent2 >= 0 ? "+" : ""}{m.elo_delta_agent2}</span>
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                            {m.finished_at ? new Date(m.finished_at).toLocaleDateString("vi-VN") : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            {m.status === "finished" && !m.is_infra_error && (
                              <Link href={`/arena/replay/${m.id}`}
                                className="rounded-lg border border-indigo-400/30 px-2 py-1 text-xs text-indigo-300 hover:bg-indigo-400/10 transition">
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
        )}

        {/* ── Sessions ── */}
        {tab === "sessions" && (
          <div className="space-y-3">
            {sessions === null ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="py-12 text-center text-slate-500">Chưa có session nào.</p>
            ) : sessions.map(s => {
              const total = s.total_matches;
              const done = s.finished_matches;
              const pct = total > 0 ? Math.round(done / total * 100) : 0;
              return (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{s.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? "bg-slate-400/20 text-slate-300"}`}>{s.status}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Tạo {new Date(s.created_at).toLocaleString("vi-VN")}
                        {s.completed_at && ` · Hoàn thành ${new Date(s.completed_at).toLocaleString("vi-VN")}`}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-400 shrink-0">
                      <span className="text-emerald-400">{done}</span>/{total} trận
                      {s.error_matches > 0 && <span className="text-orange-400 ml-1">({s.error_matches} lỗi)</span>}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-600 text-right">{pct}%</p>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-4 text-center text-xs text-slate-600">Top 100 · ELO K=32 · Không tính trận lỗi hạ tầng</p>
      </div>
    </main>
  );
}
