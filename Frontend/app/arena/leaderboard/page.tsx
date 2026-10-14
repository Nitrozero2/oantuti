"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";

type LeaderboardEntry = {
  agent_id: number;
  agent_name: string;
  description: string;
  username: string;
  version: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  error_matches: number;
  total_games: number;
  win_rate: number;
  submitted_at: string;
};

type RatingMatch = {
  id: number;
  status: string;
  outcome: string | null;
  win_reason: string;
  total_moves: number;
  is_infra_error: boolean;
  elo_delta_agent1: number | null;
  elo_delta_agent2: number | null;
  scheduled_at: string;
  finished_at: string | null;
  agent1_id: number;
  agent1_name: string;
  agent1_username: string;
  agent2_id: number;
  agent2_name: string;
  agent2_username: string;
  winner_name: string | null;
};

const MEDALS = ["🥇", "🥈", "🥉"];

function getTier(elo: number) {
  if (elo >= 2000) return { label: "Grandmaster", color: "text-amber-700", bar: "bg-amber-500", emoji: "👑" };
  if (elo >= 1800) return { label: "Master", color: "text-purple-700", bar: "bg-purple-600", emoji: "💎" };
  if (elo >= 1600) return { label: "Expert", color: "text-[#253B80]", bar: "bg-[#253B80]", emoji: "🔷" };
  if (elo >= 1400) return { label: "Intermediate", color: "text-teal-700", bar: "bg-teal-600", emoji: "🟢" };
  return { label: "Novice", color: "text-slate-600", bar: "bg-slate-400", emoji: "⚪" };
}

function EloBar({ elo }: { elo: number }) {
  const pct = Math.min(100, Math.max(0, ((elo - 800) / (2200 - 800)) * 100));
  const tier = getTier(elo);
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="h-1.5 w-16 rounded-none bg-stone-200 overflow-hidden border border-[#ded8d3]">
        <div className={`h-full ${tier.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ArenaLeaderboardPage() {
  const [tab, setTab] = useState<"rankings" | "matches">("rankings");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [matches, setMatches] = useState<RatingMatch[] | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  // Load leaderboard
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/arena/leaderboard");
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const data = (await res.json()) as { leaderboard?: LeaderboardEntry[]; error?: string };
        if (data.error) {
          setError(data.error);
          return;
        }
        setLeaderboard(data.leaderboard ?? []);
      } catch {
        setError("Không thể kết nối máy chủ.");
      }
    }
    load();
  }, [router]);

  // Load matches
  useEffect(() => {
    if (tab !== "matches") return;
    setMatches(null);
    fetch("/api/rating/matches")
      .then((r) => r.json())
      .then((d: { matches?: RatingMatch[] }) => setMatches(d.matches ?? []))
      .catch(() => setMatches([]));
  }, [tab]);

  function reloadMatches() {
    setMatches(null);
    fetch("/api/rating/matches")
      .then((r) => r.json())
      .then((d: { matches?: RatingMatch[] }) => setMatches(d.matches ?? []))
      .catch(() => setMatches([]));
  }

  function reloadLeaderboard() {
    setLeaderboard(null);
    fetch("/api/arena/leaderboard")
      .then((r) => r.json())
      .then((d: { leaderboard?: LeaderboardEntry[] }) => setLeaderboard(d.leaderboard ?? []))
      .catch(() => setLeaderboard([]));
  }

  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      {/* Header đồng bộ */}
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Tiêu đề & Các nút thao tác */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-[#ded8d3] pb-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[#1a1e29] sm:text-4xl">
              🏆 Bảng Xếp Hạng Arena
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Xếp hạng liên tục bằng TrueSkill; điểm hiển thị đã tính đến độ tin cậy của agent.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/arena/submit"
              className="rounded-none bg-[#253B80] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#1d2e66]"
            >
              + Nộp agent
            </Link>
            <Link
              href="/arena/friendly"
              className="rounded-none border border-[#ded8d3] bg-white px-4 py-2 text-xs font-bold text-[#1a1e29] transition hover:border-[#253B80] hover:text-[#253B80]"
            >
              ⚔️ Đấu thử
            </Link>
            {tab === "rankings" && (
              <button
                onClick={reloadLeaderboard}
                className="rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-[#253B80]"
                title="Làm mới bảng xếp hạng"
              >
                🔄
              </button>
            )}
          </div>
        </div>

        {/* Tier legend: Khung thẳng */}
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { emoji: "👑", label: "Grandmaster", min: 2000, c: "text-amber-800" },
            { emoji: "💎", label: "Master", min: 1800, c: "text-purple-800" },
            { emoji: "🔷", label: "Expert", min: 1600, c: "text-[#253B80]" },
            { emoji: "🟢", label: "Intermediate", min: 1400, c: "text-teal-800" },
            { emoji: "⚪", label: "Novice", min: 0, c: "text-slate-600" },
          ].map((t) => (
            <span
              key={t.label}
              className={`rounded-none border border-[#ded8d3] bg-white px-3 py-1 text-xs font-bold ${t.c}`}
            >
              {t.emoji} {t.label} {t.min > 0 ? `≥${t.min}` : "<1400"}
            </span>
          ))}
        </div>

        {/* Tabs: Khung thẳng */}
        <div className="mb-6 flex gap-1 border border-[#ded8d3] bg-white p-1 w-fit rounded-none">
          {(["rankings", "matches"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-none px-4 py-1.5 text-xs font-bold transition cursor-pointer ${
                tab === t
                  ? "bg-[#253B80] text-white"
                  : "text-slate-600 hover:text-[#253B80] hover:bg-stone-50"
              }`}
            >
              {t === "rankings" ? "📊 Xếp hạng" : "📋 Lịch sử trận"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-none border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
            <br />
            <span className="text-xs text-rose-600">Cần chạy trueskill_migration.sql trong Neon console.</span>
          </div>
        )}

        {/* ── Rankings ── */}
        {tab === "rankings" && (
          <div className="overflow-hidden rounded-none border border-[#ded8d3] bg-white shadow-md">
            {leaderboard === null && !error && (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
              </div>
            )}
            {leaderboard !== null && leaderboard.length === 0 && (
              <div className="py-16 text-center">
                <p className="mb-3 text-4xl">🤖</p>
                <p className="mb-4 text-slate-500">Chưa có agent nào trong arena.</p>
                <Link
                  href="/arena/submit"
                  className="rounded-none bg-[#253B80] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66]"
                >
                  Nộp agent đầu tiên
                </Link>
              </div>
            )}
            {leaderboard !== null && leaderboard.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#ded8d3] bg-stone-50 text-left text-xs font-bold text-slate-600">
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Tier</th>
                      <th className="px-4 py-3 text-right">Rating</th>
                      <th className="px-4 py-3 text-right">W / L / D</th>
                      <th className="px-4 py-3 text-right">Win%</th>
                      <th className="px-4 py-3 text-right">Trận</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ded8d3]">
                    {leaderboard.map((e, i) => {
                      const tier = getTier(e.elo);
                      return (
                        <tr key={e.agent_id} className="hover:bg-stone-50 transition">
                          <td className="px-4 py-3 text-slate-600 font-bold">
                            {i < 3 ? (
                              <span className="text-base">{MEDALS[i]}</span>
                            ) : (
                              <span className="font-mono text-xs">{i + 1}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/arena/agents/${e.agent_id}`}
                              className="font-bold text-[#253B80] hover:underline"
                            >
                              {e.agent_name}
                            </Link>
                            <span className="ml-1.5 font-mono text-xs text-slate-500">v{e.version}</span>
                            <span className="ml-1.5 text-xs text-slate-500">· {e.username}</span>
                            {e.description && (
                              <p className="max-w-[200px] truncate text-xs text-slate-500">
                                {e.description}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold ${tier.color}`}>
                              {tier.emoji} {tier.label}
                            </span>
                            <EloBar elo={e.elo} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-mono font-bold text-base ${tier.color}`}>{e.elo}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            <span className="font-bold text-emerald-600">{e.wins}</span>
                            <span className="text-slate-400"> / </span>
                            <span className="font-bold text-rose-600">{e.losses}</span>
                            <span className="text-slate-400"> / </span>
                            <span className="text-slate-600">{e.draws}</span>
                            {e.error_matches > 0 && (
                              <span className="ml-1 text-amber-600">⚠️{e.error_matches}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {e.total_games > 0 ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="h-1.5 w-12 rounded-none bg-stone-200 overflow-hidden border border-[#ded8d3]">
                                  <div
                                    className="h-full bg-emerald-600"
                                    style={{ width: `${e.win_rate}%` }}
                                  />
                                </div>
                                <span className="w-10 text-right font-mono text-xs font-bold text-emerald-700">
                                  {e.win_rate}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-bold text-slate-600">
                            {e.total_games}
                          </td>
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
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={reloadMatches}
                className="rounded-none border border-[#ded8d3] bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-[#253B80] cursor-pointer"
              >
                🔄 Làm mới
              </button>
            </div>

            <div className="overflow-hidden rounded-none border border-[#ded8d3] bg-white shadow-md">
              {matches === null ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-7 w-7 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
                </div>
              ) : matches.length === 0 ? (
                <p className="py-12 text-center text-slate-500">Chưa có trận đấu nào.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#ded8d3] bg-stone-50 text-left text-xs font-bold text-slate-600">
                        <th className="px-4 py-3">Agent 1</th>
                        <th className="px-3 py-3 text-center">vs</th>
                        <th className="px-4 py-3">Agent 2</th>
                        <th className="px-4 py-3">Kết quả</th>
                        <th className="px-4 py-3 text-right">Nước</th>
                        <th className="px-4 py-3">Rating ±</th>
                        <th className="px-4 py-3 text-right">Ngày</th>
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
                            <p className="text-xs text-slate-500">{m.agent1_username}</p>
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs font-bold text-slate-400">vs</td>
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/arena/agents/${m.agent2_id}`}
                              className="font-bold text-rose-700 hover:underline"
                            >
                              {m.agent2_name}
                            </Link>
                            <p className="text-xs text-slate-500">{m.agent2_username}</p>
                          </td>
                          <td className="px-4 py-2.5">
                            {m.is_infra_error ? (
                              <span className="text-xs font-bold text-amber-600">⚠️ Lỗi hạ tầng</span>
                            ) : m.winner_name ? (
                              <span className="text-xs font-bold text-amber-700">🏆 {m.winner_name}</span>
                            ) : m.outcome === "draw" ? (
                              <span className="text-xs font-bold text-slate-600">Hòa</span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                            {m.total_moves}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs">
                            {!m.is_infra_error && m.elo_delta_agent1 != null && (
                              <span>
                                <span
                                  className={
                                    m.elo_delta_agent1 >= 0 ? "font-bold text-emerald-600" : "font-bold text-rose-600"
                                  }
                                >
                                  {m.elo_delta_agent1 >= 0 ? "+" : ""}
                                  {m.elo_delta_agent1}
                                </span>
                                <span className="text-slate-400"> / </span>
                                <span
                                  className={
                                    m.elo_delta_agent2 != null && m.elo_delta_agent2 >= 0
                                      ? "font-bold text-emerald-600"
                                      : "font-bold text-rose-600"
                                  }
                                >
                                  {m.elo_delta_agent2 != null && m.elo_delta_agent2 >= 0 ? "+" : ""}
                                  {m.elo_delta_agent2}
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                            {m.finished_at ? new Date(m.finished_at).toLocaleDateString("vi-VN") : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {m.status === "finished" && !m.is_infra_error && (
                              <Link
                                href={`/arena/replay/rating/${m.id}`}
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
          </div>
        )}

        <p className="mt-8 text-center text-xs text-slate-500">
          Top 100 · TrueSkill · Không tính trận lỗi hạ tầng · Nền tảng OTTv2 Arena
        </p>
      </main>
    </div>
  );
}
