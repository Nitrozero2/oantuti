"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

type Status = {
  summary: { rating_scheduled?: number; rating_running?: number; validating?: number; rating_finished?: number };
  agents: Array<{ id: number; agent_name: string; username: string; rating: number; trueskill_mu: number; trueskill_sigma: number; wins: number; losses: number; draws: number }>;
  matches: Array<{
    id: number; status: string; outcome: string | null; is_infra_error: boolean; finished_at: string | null;
    agent1_name: string; agent2_name: string;
    agent1_mu_before: number | null; agent1_sigma_before: number | null; agent1_mu_after: number | null; agent1_sigma_after: number | null;
    agent2_mu_before: number | null; agent2_sigma_before: number | null; agent2_mu_after: number | null; agent2_sigma_after: number | null;
    rating_delta_agent1: number | null; rating_delta_agent2: number | null;
  }>;
  scheduler_enabled: boolean;
};

function confidence(sigma: number) {
  return Math.max(0, Math.min(100, Math.round((1 - sigma / (25 / 3)) * 100)));
}

export default function AdminRatingPage() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState("");
  const load = () => {
    fetch("/api/admin/rating/status")
      .then(async (response) => ({ ok: response.ok, body: await response.json() as Status & { error?: string } }))
      .then(({ ok, body }) => ok ? setData(body) : setError(body.error ?? "Không có quyền."))
      .catch(() => setError("Không thể tải trạng thái rating."));
  };
  useEffect(load, []);
  async function rebuildHistory() {
    setRebuilding(true);
    setRebuildMessage("");
    try {
      const response = await fetch("/api/admin/rating/rebuild", { method: "POST" });
      const body = await response.json() as { ok?: boolean; replayed_matches?: number; updated_agents?: number; error?: string };
      if (!response.ok) {
        setRebuildMessage(body.error ?? "Không thể dựng lại lịch sử.");
        return;
      }
      setRebuildMessage(`Đã dựng lại ${body.replayed_matches ?? 0} trận cho ${body.updated_agents ?? 0} agent.`);
      load();
    } catch {
      setRebuildMessage("Không thể kết nối máy chủ.");
    } finally {
      setRebuilding(false);
    }
  }
  const summary = data?.summary;
  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start justify-between border-b border-[#ded8d3] pb-5">
          <div>
            <h1 className="text-3xl font-extrabold">TrueSkill Queue</h1>
            <p className="mt-1 text-sm text-slate-600">Agent có độ tin cậy thấp được ưu tiên ghép trận trước.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={rebuildHistory} disabled={rebuilding} className="border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">{rebuilding ? "Đang dựng lại..." : "Dựng lại từ lịch sử"}</button>
            <button onClick={load} className="border border-[#ded8d3] bg-white px-4 py-2 text-xs font-bold hover:border-[#253B80]">Làm mới</button>
          </div>
        </div>
        {error && <p className="mb-4 border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {rebuildMessage && <p className="mb-4 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{rebuildMessage}</p>}
        {data && !data.scheduler_enabled && <p className="mb-4 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">Queue đang tắt để bảo toàn lịch sử. Chọn “Dựng lại từ lịch sử” để khởi tạo rating và bật queue.</p>}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Đang self-play", summary?.validating ?? 0], ["Đang chờ", summary?.rating_scheduled ?? 0],
            ["Đang chạy", summary?.rating_running ?? 0], ["Đã xong", summary?.rating_finished ?? 0],
          ].map(([label, value]) => <div key={String(label)} className="border border-[#ded8d3] bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-[#253B80]">{value}</p></div>)}
        </div>
        <div className="overflow-hidden border border-[#ded8d3] bg-white">
          <div className="border-b border-[#ded8d3] px-4 py-3 text-sm font-bold">Ưu tiên tiếp theo</div>
          <table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Agent</th><th className="px-4 py-3 text-right">Rating</th><th className="px-4 py-3 text-right">μ</th><th className="px-4 py-3 text-right">σ</th><th className="px-4 py-3 text-right">Tin cậy</th></tr></thead>
            <tbody>{data?.agents.map((agent) => <tr key={agent.id} className="border-t border-[#eee]"><td className="px-4 py-3"><Link className="font-bold text-[#253B80] hover:underline" href={`/arena/agents/${agent.id}`}>{agent.agent_name}</Link><span className="ml-2 text-xs text-slate-500">@{agent.username}</span></td><td className="px-4 py-3 text-right font-mono">{agent.rating}</td><td className="px-4 py-3 text-right font-mono">{Number(agent.trueskill_mu).toFixed(2)}</td><td className="px-4 py-3 text-right font-mono">{Number(agent.trueskill_sigma).toFixed(2)}</td><td className="px-4 py-3 text-right font-mono">{confidence(Number(agent.trueskill_sigma))}%</td></tr>)}</tbody>
          </table>
        </div>
        <div className="mt-6 overflow-hidden border border-[#ded8d3] bg-white">
          <div className="border-b border-[#ded8d3] px-4 py-3 text-sm font-bold">Lịch sử cập nhật TrueSkill</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs"><thead className="bg-stone-50 text-slate-500"><tr><th className="px-4 py-3">Trận</th><th className="px-4 py-3">Kết quả</th><th className="px-4 py-3">Agent 1: μ / σ</th><th className="px-4 py-3">Agent 2: μ / σ</th><th className="px-4 py-3">Rating ±</th></tr></thead>
              <tbody>{data?.matches.map((match) => {
                const hasSnapshot = match.agent1_mu_after !== null && match.agent2_mu_after !== null;
                const outcome = match.is_infra_error ? "Lỗi hạ tầng" : match.outcome === "draw" ? "Hòa" : match.outcome === "agent1" ? `${match.agent1_name} thắng` : match.outcome === "agent2" ? `${match.agent2_name} thắng` : match.status;
                const metric = (before: number | null, after: number | null) => hasSnapshot ? `${Number(before).toFixed(2)} → ${Number(after).toFixed(2)}` : "—";
                const delta = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value}`;
                return <tr key={match.id} className="border-t border-[#eee]"><td className="px-4 py-3 font-medium">{match.agent1_name} <span className="text-slate-400">vs</span> {match.agent2_name}</td><td className="px-4 py-3">{outcome}</td><td className="px-4 py-3 font-mono">{metric(match.agent1_mu_before, match.agent1_mu_after)} / {metric(match.agent1_sigma_before, match.agent1_sigma_after)}</td><td className="px-4 py-3 font-mono">{metric(match.agent2_mu_before, match.agent2_mu_after)} / {metric(match.agent2_sigma_before, match.agent2_sigma_after)}</td><td className="px-4 py-3 font-mono">{delta(match.rating_delta_agent1)} / {delta(match.rating_delta_agent2)}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
