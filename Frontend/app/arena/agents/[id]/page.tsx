"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type AgentDetail = {
  id: number; agent_name: string; description: string; username: string;
  version: number; status: string; validation_error: string | null;
  is_active: boolean; wins: number; losses: number; draws: number;
  error_matches: number; elo: number; submitted_at: string;
};

type MatchRow = {
  id: number; status: string; outcome: string | null; win_reason: string;
  total_moves: number; is_infra_error: boolean;
  elo_delta_agent1: number | null; elo_delta_agent2: number | null;
  scheduled_at: string; finished_at: string | null;
  agent1_id: number; agent1_name: string; agent1_username: string;
  agent2_id: number; agent2_name: string; agent2_username: string;
  winner_name: string | null; session_name: string | null;
};

type VersionRow = {
  id: number; version: number; agent_name: string; status: string;
  elo: number; wins: number; losses: number; draws: number; submitted_at: string;
};

function getTier(elo: number) {
  if (elo >= 2000) return { label: "Grandmaster", color: "text-amber-300", emoji: "👑" };
  if (elo >= 1800) return { label: "Master",      color: "text-violet-300", emoji: "💎" };
  if (elo >= 1600) return { label: "Expert",       color: "text-blue-300",   emoji: "🔷" };
  if (elo >= 1400) return { label: "Intermediate", color: "text-teal-300",   emoji: "🟢" };
  return                  { label: "Novice",       color: "text-slate-400",  emoji: "⚪" };
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-400/20 text-emerald-300",
  pending: "bg-slate-400/20 text-slate-300",
  validating: "bg-yellow-400/20 text-yellow-300",
  rejected: "bg-rose-400/20 text-rose-300",
};

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/arena/agents/${agentId}`)
      .then(r => r.json())
      .then((d: { agent?: AgentDetail; matches?: MatchRow[]; versions?: VersionRow[]; error?: string }) => {
        if (d.error) { setError(d.error); return; }
        setAgent(d.agent!);
        setMatches(d.matches ?? []);
        setVersions(d.versions ?? []);
      })
      .catch(() => setError("Không thể tải thông tin agent."));
  }, [agentId]);

  if (error) return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-rose-300 mb-3">⚠️ {error}</p>
        <Link href="/arena/leaderboard" className="text-sm text-slate-400 hover:text-white">← Leaderboard</Link>
      </div>
    </main>
  );

  if (!agent) return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
    </main>
  );

  const tier = getTier(agent.elo);
  const totalGames = agent.wins + agent.losses + agent.draws;
  const winRate = totalGames > 0 ? Math.round(agent.wins / totalGames * 100) : 0;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/arena/leaderboard" className="text-sm text-slate-400 hover:text-white">← Leaderboard</Link>
        </div>

        {/* Agent header */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">{agent.agent_name}</h1>
                <span className="text-xs text-slate-500">v{agent.version}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[agent.status] ?? "bg-slate-400/20 text-slate-300"}`}>
                  {agent.status}
                </span>
              </div>
              <p className="mt-1 text-slate-400 text-sm">by <span className="text-white font-medium">{agent.username}</span></p>
              {agent.description && <p className="mt-2 text-sm text-slate-400">{agent.description}</p>}
            </div>
            <div className="text-right">
              <p className={`text-3xl font-black ${tier.color}`}>{agent.elo}</p>
              <p className={`text-sm font-medium ${tier.color}`}>{tier.emoji} {tier.label}</p>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {[
              { label: "Thắng", value: agent.wins, color: "text-emerald-400" },
              { label: "Thua", value: agent.losses, color: "text-rose-400" },
              { label: "Hòa", value: agent.draws, color: "text-slate-400" },
              { label: "Lỗi", value: agent.error_matches, color: "text-orange-400" },
              { label: "Win%", value: `${winRate}%`, color: "text-teal-300" },
              { label: "Tổng", value: totalGames, color: "text-slate-300" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Match history */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="font-semibold">📋 Lịch sử trận đấu</h2>
          </div>
          {matches.length === 0 ? (
            <p className="py-8 text-center text-slate-500 text-sm">Chưa có trận nào.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-white/10 text-left">
                    <th className="px-4 py-3 font-medium">Đối thủ</th>
                    <th className="px-4 py-3 font-medium">Kết quả</th>
                    <th className="px-4 py-3 text-right font-medium">ELO ±</th>
                    <th className="px-4 py-3 text-right font-medium">Nước</th>
                    <th className="px-4 py-3 text-right font-medium">Ngày</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {matches.map(m => {
                    const isAgent1 = m.agent1_id === Number(agentId);
                    const opponent = isAgent1 ? { name: m.agent2_name, user: m.agent2_username, id: m.agent2_id } : { name: m.agent1_name, user: m.agent1_username, id: m.agent1_id };
                    const myOutcome = m.is_infra_error ? "error"
                      : m.outcome === "draw" ? "draw"
                      : (m.outcome === "agent1" && isAgent1) || (m.outcome === "agent2" && !isAgent1) ? "win" : "loss";
                    const eloDelta = isAgent1 ? m.elo_delta_agent1 : m.elo_delta_agent2;
                    const resultBadge = {
                      win: "text-emerald-400 font-semibold", loss: "text-rose-400 font-semibold",
                      draw: "text-slate-400", error: "text-orange-400",
                    }[myOutcome];
                    const resultLabel = { win: "Thắng ✓", loss: "Thua ✗", draw: "Hòa", error: "⚠️ Lỗi" }[myOutcome];
                    return (
                      <tr key={m.id} className={`hover:bg-white/[0.02] ${m.is_infra_error ? "opacity-60" : ""}`}>
                        <td className="px-4 py-2.5">
                          <Link href={`/arena/agents/${opponent.id}`} className="hover:text-indigo-300 transition font-medium">{opponent.name}</Link>
                          <p className="text-xs text-slate-500">{opponent.user}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-sm ${resultBadge}`}>{resultLabel}</span>
                          {m.win_reason && <p className="text-xs text-slate-600 truncate max-w-[160px]">{m.win_reason}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">
                          {!m.is_infra_error && eloDelta != null && (
                            <span className={eloDelta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                              {eloDelta >= 0 ? "+" : ""}{eloDelta}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-400">{m.total_moves}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                          {m.finished_at ? new Date(m.finished_at).toLocaleDateString("vi-VN") : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {m.status === "finished" && !m.is_infra_error && (
                            <Link href={`/arena/replay/${m.id}`}
                              className="rounded-lg border border-indigo-400/30 px-2 py-0.5 text-xs text-indigo-300 hover:bg-indigo-400/10 transition">
                              ▶ Replay
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Version history */}
        {versions.length > 1 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="font-semibold">🕐 Lịch sử phiên bản</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-white/10 text-left">
                    <th className="px-4 py-3 font-medium">Phiên bản</th>
                    <th className="px-4 py-3 font-medium">Tên</th>
                    <th className="px-4 py-3 font-medium">Trạng thái</th>
                    <th className="px-4 py-3 text-right font-medium">ELO</th>
                    <th className="px-4 py-3 text-right font-medium">W/L/D</th>
                    <th className="px-4 py-3 text-right font-medium">Ngày nộp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {versions.map(v => (
                    <tr key={v.id} className={`hover:bg-white/[0.02] ${v.id === Number(agentId) ? "bg-indigo-400/5" : ""}`}>
                      <td className="px-4 py-2.5">
                        <Link href={`/arena/agents/${v.id}`} className={`font-mono hover:text-indigo-300 ${v.id === Number(agentId) ? "text-indigo-300" : "text-slate-400"}`}>
                          v{v.version}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">{v.agent_name}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[v.status] ?? "bg-slate-400/20 text-slate-300"}`}>
                          {v.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm">{v.elo}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">
                        <span className="text-emerald-400">{v.wins}</span>/<span className="text-rose-400">{v.losses}</span>/<span className="text-slate-400">{v.draws}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                        {new Date(v.submitted_at).toLocaleDateString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
