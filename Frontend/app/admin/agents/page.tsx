"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

type Agent = {
  id: number;
  agent_name: string;
  description: string;
  code: string;
  version: number;
  status: string;
  validation_error: string | null;
  is_active: boolean;
  wins: number;
  losses: number;
  draws: number;
  error_matches: number;
  elo: number;
  submitted_at: string;
  username: string;
  user_id: number;
};

const STATUS_BADGE: Record<string, string> = {
  active:     "bg-emerald-400/20 text-emerald-300",
  pending:    "bg-slate-400/20 text-slate-300",
  validating: "bg-yellow-400/20 text-yellow-300",
  rejected:   "bg-rose-400/20 text-rose-300",
};

const FILTER_TABS = [
  { value: "", label: "Tất cả" },
  { value: "pending", label: "Chờ duyệt" },
  { value: "validating", label: "Đang kiểm tra" },
  { value: "active", label: "Active" },
  { value: "rejected", label: "Từ chối" },
];

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState<number | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter
        ? `/api/admin/agents?status=${filter}`
        : "/api/admin/agents";
      const res = await fetch(url);
      const data = await res.json() as { agents?: Agent[]; error?: string };
      if (data.error) { setError(data.error); return; }
      setAgents(data.agents ?? []);
    } catch {
      setError("Không thể tải danh sách agent.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  async function validateAgent(agent: Agent) {
    setValidating(agent.id); setError("");
    try {
      const res = await fetch(`/api/arena/agents/${agent.id}/activate`, {
        method: "POST",
      });
      const data = await res.json() as { ok?: boolean; status?: string; validation_error?: string; error?: string };
      if (!res.ok && res.status !== 200) {
        setError(data.error ?? "Kích hoạt thất bại.");
      }
      await loadAgents();
    } catch {
      setError("Không thể kết nối backend để kiểm tra.");
    } finally {
      setValidating(null);
    }
  }

  async function patchStatus(agentId: number, status: string, validationError: string | null) {
    setBusy(agentId); setError("");
    try {
      const res = await fetch(`/api/arena/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, validation_error: validationError }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setError(data.error ?? "Cập nhật thất bại."); return; }
      await loadAgents();
    } catch {
      setError("Không thể cập nhật agent.");
    } finally {
      setBusy(null);
    }
  }

  async function handleActivate(agent: Agent) {
    // Validate first, then activate
    await validateAgent(agent);
  }

  async function handleReject(agent: Agent) {
    const reason = prompt(`Lý do từ chối agent "${agent.agent_name}" (${agent.username})?`, "Agent không đáp ứng yêu cầu.");
    if (reason === null) return; // cancelled
    await patchStatus(agent.id, "rejected", reason || "Bị từ chối bởi admin.");
  }

  async function handleReset(agent: Agent) {
    await patchStatus(agent.id, "pending", null);
  }

  const pendingCount = agents.filter(a => a.status === "pending").length;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
          <span className="text-slate-700">/</span>
          <Link href="/admin/tournament" className="hover:text-white">Tournament</Link>
          <span className="text-slate-700">/</span>
          <span className="text-white">Duyệt Agent</span>
        </div>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">🤖 Quản lý Agent</h1>
            <p className="mt-1 text-slate-400 text-sm">
              Xem xét và duyệt agent do người dùng nộp. Chỉ agent active mới tham gia ghép trận.
            </p>
          </div>
          <button
            onClick={loadAgents}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/5 transition"
          >
            🔄 Làm mới
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* Filter tabs */}
        <div className="mb-5 flex gap-1 rounded-xl border border-white/10 bg-black/20 p-1 w-fit flex-wrap">
          {FILTER_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                filter === t.value
                  ? "bg-indigo-500/30 text-indigo-200"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
              {t.value === "pending" && pendingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-orange-500/60 px-1.5 py-0.5 text-xs text-white font-semibold">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Agent list */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] py-16 text-center">
            <p className="text-slate-500">Không có agent nào{filter ? ` với status "${filter}"` : ""}.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {agents.map(agent => (
              <div
                key={agent.id}
                className={`rounded-2xl border p-5 ${
                  agent.status === "pending"
                    ? "border-orange-400/20 bg-orange-400/5"
                    : agent.status === "active"
                    ? "border-emerald-400/20 bg-emerald-400/5"
                    : agent.status === "rejected"
                    ? "border-rose-400/15 bg-rose-400/5"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/arena/agents/${agent.id}`}
                        className="font-bold text-white hover:text-indigo-300 transition text-lg"
                      >
                        {agent.agent_name}
                      </Link>
                      <span className="text-xs text-slate-500">v{agent.version}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[agent.status] ?? "bg-slate-400/20 text-slate-300"}`}>
                        {agent.status}
                      </span>
                      {agent.is_active && (
                        <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300">
                          ✓ Arena Active
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-300">
                      by <span className="font-semibold text-white">@{agent.username}</span>
                      <span className="text-slate-500 ml-2">· nộp {new Date(agent.submitted_at).toLocaleString("vi-VN")}</span>
                    </p>
                    {agent.description && (
                      <p className="mt-1 text-xs text-slate-400 italic">{agent.description}</p>
                    )}
                    {agent.validation_error && (
                      <p className="mt-1 text-xs text-rose-300">
                        ❌ Lỗi: {agent.validation_error}
                      </p>
                    )}
                    <div className="mt-2 flex gap-4 text-xs text-slate-500">
                      <span>ELO: <span className="font-mono font-bold text-slate-300">{agent.elo}</span></span>
                      <span className="text-emerald-400">W:{agent.wins}</span>
                      <span className="text-rose-400">L:{agent.losses}</span>
                      <span className="text-slate-400">D:{agent.draws}</span>
                      {agent.error_matches > 0 && (
                        <span className="text-orange-400">⚠️{agent.error_matches}</span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap shrink-0">
                    {(agent.status === "pending" || agent.status === "validating") && (
                      <button
                        onClick={() => handleActivate(agent)}
                        disabled={busy === agent.id || validating === agent.id}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-60"
                      >
                        {validating === agent.id
                          ? "⏳ Đang kiểm tra..."
                          : "✅ Validate & Activate"}
                      </button>
                    )}
                    {agent.status === "pending" && (
                      <button
                        onClick={() => handleReject(agent)}
                        disabled={busy === agent.id || validating === agent.id}
                        className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 transition disabled:opacity-60"
                      >
                        ❌ Từ chối
                      </button>
                    )}
                    {agent.status === "active" && (
                      <button
                        onClick={() => patchStatus(agent.id, "pending", null)}
                        disabled={busy === agent.id}
                        className="rounded-xl border border-slate-400/20 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition disabled:opacity-60"
                      >
                        ↩ Deactivate
                      </button>
                    )}
                    {agent.status === "rejected" && (
                      <button
                        onClick={() => handleReset(agent)}
                        disabled={busy === agent.id}
                        className="rounded-xl border border-slate-400/20 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition disabled:opacity-60"
                      >
                        ↩ Đặt lại pending
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
                      className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/5 transition"
                    >
                      {expandedId === agent.id ? "Ẩn code" : "Xem code"}
                    </button>
                  </div>
                </div>

                {/* Code viewer */}
                {expandedId === agent.id && (
                  <div className="mt-4 rounded-xl overflow-hidden border border-white/10">
                    <div className="flex items-center justify-between bg-black/30 px-3 py-2">
                      <span className="text-xs text-slate-400 font-mono">
                        {agent.agent_name} v{agent.version} · {agent.code.length.toLocaleString()} chars
                      </span>
                    </div>
                    <CodeMirror
                      value={agent.code}
                      height="300px"
                      extensions={[python()]}
                      theme={oneDark}
                      editable={false}
                      basicSetup={{ lineNumbers: true, syntaxHighlighting: true }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
