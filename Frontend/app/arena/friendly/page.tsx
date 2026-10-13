"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import BackendOfflineBanner from "@/components/BackendOfflineBanner";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentOption = {
  id: number;
  agent_name: string;
  username: string;
  user_id: number;
  elo: number;
};

type Challenge = {
  id: number;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  message: string;
  created_at: string;
  responded_at: string | null;
  expires_at: string;
  friendly_match_id: number | null;
  // challenger
  challenger_id: number;
  challenger_username: string;
  challenger_agent_id: number;
  challenger_agent_name: string;
  challenger_agent_elo: number;
  // opponent
  opponent_id: number;
  opponent_username: string;
  opponent_agent_id: number;
  opponent_agent_name: string;
  opponent_agent_elo: number;
  // match result
  match_status: string | null;
  match_outcome: string | null;
  match_total_moves: number | null;
  match_pending_backend: boolean | null;
  match_winner_name: string | null;
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
  pending_backend: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CHALLENGE_STATUS_BADGE: Record<string, string> = {
  pending:   "bg-amber-50 text-amber-700 border-amber-300",
  accepted:  "bg-emerald-50 text-emerald-700 border-emerald-300",
  declined:  "bg-rose-50 text-rose-700 border-rose-300",
  cancelled: "bg-slate-100 text-slate-600 border-slate-300",
  expired:   "bg-slate-100 text-slate-500 border-slate-200",
};

const MATCH_STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-700 border-slate-300",
  running:   "bg-amber-50 text-amber-700 border-amber-300",
  finished:  "bg-emerald-50 text-emerald-700 border-emerald-300",
  error:     "bg-rose-50 text-rose-700 border-rose-300",
};

const OUTCOME_LABEL: Record<string, string> = {
  agent1: "Bot1 thắng",
  agent2: "Bot2 thắng",
  draw:   "Hòa",
};

type Tab = "challenge" | "received" | "sent" | "history";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FriendlyPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("challenge");

  // Agents
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [myAgents, setMyAgents] = useState<AgentOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  // Challenge form
  const [myAgentId, setMyAgentId] = useState<number | "">("");
  const [theirAgentId, setTheirAgentId] = useState<number | "">("");
  const [challengeMsg, setChallengeMsg] = useState("");
  const [sendingChallenge, setSendingChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState("");
  const [challengeSuccess, setChallengeSuccess] = useState("");

  // Challenges lists
  const [received, setReceived] = useState<Challenge[]>([]);
  const [sent, setSent] = useState<Challenge[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingChallenges, setLoadingChallenges] = useState(false);
  const [respondingId, setRespondingId] = useState<number | null>(null);

  // Match history
  const [matches, setMatches] = useState<FriendlyMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

  // Backend status
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [processingPending, setProcessingPending] = useState(false);
  const [processResult, setProcessResult] = useState<{ processed: number; errors: number } | null>(null);

  // Current user id (needed to determine "my" vs "their" in challenge display)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // ─── Load data ──────────────────────────────────────────────────────────────

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const res = await fetch("/api/arena/agents/all-active");
      if (res.status === 401) { router.push("/login"); return; }
      const d = await res.json() as { agents?: AgentOption[]; current_user_id?: number };
      const all = d.agents ?? [];
      setAgents(all);
      // Lấy user id từ session
      const sessionRes = await fetch("/api/auth/me").catch(() => null);
      if (sessionRes?.ok) {
        const sd = await sessionRes.json() as { user?: { id?: number } };
        const uid = sd.user?.id ? Number(sd.user.id) : null;
        if (uid) {
          setCurrentUserId(uid);
          setMyAgents(all.filter(a => Number(a.user_id) === uid));
        }
      }
    } catch {
      setChallengeError("Không thể tải danh sách agent.");
    } finally {
      setLoadingAgents(false);
    }
  }, [router]);

  const loadChallenges = useCallback(async () => {
    setLoadingChallenges(true);
    try {
      const res = await fetch("/api/friendly/challenges?type=all");
      if (!res.ok) return;
      const d = await res.json() as {
        challenges?: Challenge[];
        pending_received_count?: number;
      };
      const all = d.challenges ?? [];
      setReceived(all.filter(c => c.opponent_id === currentUserId));
      setSent(all.filter(c => c.challenger_id === currentUserId));
      setPendingCount(d.pending_received_count ?? 0);
    } catch {/* silent */}
    finally { setLoadingChallenges(false); }
  }, [currentUserId]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    try {
      const res = await fetch("/api/friendly");
      if (!res.ok) return;
      const d = await res.json() as { matches?: FriendlyMatch[] };
      setMatches(d.matches ?? []);
    } catch {/* silent */}
    finally { setLoadingMatches(false); }
  }, []);

  const checkBackend = useCallback(async () => {
    try {
      const r = await fetch("/api/backend-status");
      const d = await r.json() as { online: boolean };
      setBackendOnline(d.online);
    } catch { setBackendOnline(false); }
  }, []);

  useEffect(() => {
    loadAgents();
    checkBackend();
  }, [loadAgents, checkBackend]);

  useEffect(() => {
    if (currentUserId !== null) {
      loadChallenges();
    }
  }, [currentUserId, loadChallenges]);

  useEffect(() => {
    if (tab === "history") loadMatches();
    if (tab === "received" || tab === "sent") loadChallenges();
  }, [tab, loadMatches, loadChallenges]);

  // Auto-refresh khi backend offline → online để process pending
  useEffect(() => {
    if (backendOnline !== true) return;
    // Nếu có pending matches → tự gọi process
    const hasPending = matches.some(m => m.pending_backend && m.status === "scheduled");
    if (hasPending) processPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function sendChallenge() {
    if (!myAgentId || !theirAgentId) return;
    setSendingChallenge(true);
    setChallengeError("");
    setChallengeSuccess("");
    try {
      const res = await fetch("/api/friendly/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenger_agent_id: myAgentId,
          opponent_agent_id: theirAgentId,
          message: challengeMsg,
        }),
      });
      const d = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) { setChallengeError(d.error ?? "Lỗi gửi thách đấu."); return; }
      setChallengeSuccess(d.message ?? "Đã gửi lời thách đấu!");
      setMyAgentId("");
      setTheirAgentId("");
      setChallengeMsg("");
      // Switch sang tab sent
      setTab("sent");
      loadChallenges();
    } catch { setChallengeError("Không thể kết nối."); }
    finally { setSendingChallenge(false); }
  }

  async function respond(challengeId: number, action: "accept" | "decline") {
    setRespondingId(challengeId);
    try {
      const res = await fetch(`/api/friendly/challenges/${challengeId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) { alert(d.error ?? "Lỗi."); return; }
      if (action === "accept" && d.message) alert(d.message);
      await loadChallenges();
      // Nếu backend online → tự process
      if (action === "accept" && backendOnline) {
        await processPending();
      }
    } catch { alert("Không thể kết nối."); }
    finally { setRespondingId(null); }
  }

  async function processPending(matchId?: number) {
    setProcessingPending(true);
    setProcessResult(null);
    try {
      const res = await fetch("/api/friendly/process-pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matchId ? { match_id: matchId } : {}),
      });
      const d = await res.json() as {
        ok?: boolean; processed?: number; errors?: number;
        message?: string; backend_online?: boolean; error?: string;
      };
      if (res.ok && d.processed !== undefined) {
        setProcessResult({ processed: d.processed, errors: d.errors ?? 0 });
        await loadChallenges();
        await loadMatches();
      }
    } catch {/* silent */}
    finally { setProcessingPending(false); }
  }

  // ─── Derived ────────────────────────────────────────────────────────────────

  // Opponents: agents không phải của mình
  const opponentAgents = agents.filter(a => a.user_id !== currentUserId);
  const byUser = opponentAgents.reduce<Record<string, AgentOption[]>>((acc, a) => {
    if (!acc[a.username]) acc[a.username] = [];
    acc[a.username].push(a);
    return acc;
  }, {});

  const selectedMyAgent = myAgents.find(a => a.id === myAgentId);
  const selectedTheirAgent = agents.find(a => a.id === theirAgentId);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 border-b border-[#ded8d3] pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-3">
            <Link href="/dashboard" className="hover:text-[#253B80]">Dashboard</Link>
            <span>/</span>
            <span className="text-[#1a1e29]">Đấu Đối Kháng</span>
          </div>
          <h1 className="text-3xl font-extrabold text-[#1a1e29]">⚔️ Đấu Đối Kháng</h1>
          <p className="mt-1 text-sm text-slate-600">
            Gửi lời thách đấu tới agent của người khác. Kết quả không tính ELO chính thức.
          </p>
        </div>

        {/* Backend banner */}
        <BackendOfflineBanner
          isOffline={backendOnline === false}
          checking={backendOnline === null}
          className="mb-4 rounded-none border border-amber-300 bg-amber-50 text-amber-900"
        />

        {/* Process result banner */}
        {processResult && (
          <div className="mb-4 rounded-none border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 flex items-center justify-between">
            <span>⚡ Đã xử lý {processResult.processed} trận{processResult.errors > 0 && `, ${processResult.errors} lỗi`}.</span>
            <button onClick={() => setProcessResult(null)} className="text-xs opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex gap-0 border-b border-[#ded8d3]">
          {([
            { key: "challenge", label: "⚔️ Gửi thách đấu" },
            { key: "received", label: `📥 Nhận được${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
            { key: "sent", label: "📤 Đã gửi" },
            { key: "history", label: "📋 Lịch sử trận" },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`cursor-pointer px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                tab === t.key
                  ? "border-[#253B80] text-[#253B80]"
                  : "border-transparent text-slate-500 hover:text-[#1a1e29]"
              } ${t.key === "received" && pendingCount > 0 ? "text-amber-700" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Gửi thách đấu ─────────────────────────────────────────────── */}
        {tab === "challenge" && (
          <div className="rounded-none border border-[#ded8d3] bg-white p-6 shadow-md">
            <h2 className="mb-5 text-base font-bold text-[#253B80]">Chọn agent để thách đấu</h2>

            {loadingAgents ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {/* Agent của mình */}
                  <div>
                    <p className="mb-2 text-xs font-bold text-[#253B80]">🟦 Agent của bạn</p>
                    {myAgents.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">
                        Bạn chưa có agent active.{" "}
                        <Link href="/arena/submit" className="text-[#253B80] hover:underline">Nộp agent →</Link>
                      </p>
                    ) : (
                      <select
                        value={myAgentId}
                        onChange={e => setMyAgentId(e.target.value ? Number(e.target.value) : "")}
                        className="w-full rounded-none border border-[#ded8d3] bg-white px-3 py-2.5 text-sm font-semibold text-[#1a1e29] outline-none focus:border-[#253B80]"
                      >
                        <option value="">-- Chọn agent của bạn --</option>
                        {myAgents.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.agent_name} (ELO {a.elo})
                          </option>
                        ))}
                      </select>
                    )}
                    {selectedMyAgent && (
                      <p className="mt-1.5 text-xs text-slate-500">
                        ELO: <strong>{selectedMyAgent.elo}</strong>
                      </p>
                    )}
                  </div>

                  {/* Agent đối thủ */}
                  <div>
                    <p className="mb-2 text-xs font-bold text-rose-700">🟥 Agent đối thủ</p>
                    {opponentAgents.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">Chưa có agent active của người khác.</p>
                    ) : (
                      <select
                        value={theirAgentId}
                        onChange={e => setTheirAgentId(e.target.value ? Number(e.target.value) : "")}
                        className="w-full rounded-none border border-[#ded8d3] bg-white px-3 py-2.5 text-sm font-semibold text-[#1a1e29] outline-none focus:border-rose-400"
                      >
                        <option value="">-- Chọn agent đối thủ --</option>
                        {Object.entries(byUser).map(([username, list]) => (
                          <optgroup key={username} label={`@${username}`}>
                            {list.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.agent_name} (ELO {a.elo})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                    {selectedTheirAgent && (
                      <p className="mt-1.5 text-xs text-slate-500">
                        Của <strong>@{selectedTheirAgent.username}</strong> · ELO: <strong>{selectedTheirAgent.elo}</strong>
                      </p>
                    )}
                  </div>
                </div>

                {/* Preview matchup */}
                {selectedMyAgent && selectedTheirAgent && (
                  <div className="mt-4 flex items-center justify-center gap-4 rounded-none border border-[#ded8d3] bg-[#F5F0ED] py-4 px-6">
                    <div className="text-center">
                      <p className="text-xs font-bold text-[#253B80]">{selectedMyAgent.agent_name}</p>
                      <p className="text-[11px] text-slate-500">@{selectedMyAgent.username}</p>
                      <p className="font-mono text-xs font-bold text-[#253B80]">ELO {selectedMyAgent.elo}</p>
                    </div>
                    <span className="text-xl font-black text-slate-400">⚔️</span>
                    <div className="text-center">
                      <p className="text-xs font-bold text-rose-700">{selectedTheirAgent.agent_name}</p>
                      <p className="text-[11px] text-slate-500">@{selectedTheirAgent.username}</p>
                      <p className="font-mono text-xs font-bold text-rose-700">ELO {selectedTheirAgent.elo}</p>
                    </div>
                  </div>
                )}

                {/* Message */}
                <div className="mt-4">
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Tin nhắn kèm thách đấu (tùy chọn)
                  </label>
                  <input
                    value={challengeMsg}
                    onChange={e => setChallengeMsg(e.target.value)}
                    maxLength={200}
                    placeholder="Ví dụ: Xem ai giỏi hơn nhé!"
                    className="w-full rounded-none border border-[#ded8d3] bg-white px-3 py-2 text-sm text-[#1a1e29] outline-none focus:border-[#253B80]"
                  />
                </div>

                {/* Errors / success */}
                {challengeError && (
                  <p className="mt-3 text-xs font-bold text-rose-700">❌ {challengeError}</p>
                )}
                {challengeSuccess && (
                  <p className="mt-3 text-xs font-bold text-emerald-700">✅ {challengeSuccess}</p>
                )}

                {/* Send button */}
                <button
                  onClick={sendChallenge}
                  disabled={!myAgentId || !theirAgentId || sendingChallenge}
                  className="mt-5 cursor-pointer rounded-none bg-[#253B80] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#1d2e66] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingChallenge ? "Đang gửi..." : "📨 Gửi lời thách đấu"}
                </button>

                <p className="mt-3 text-xs text-slate-500">
                  Đối thủ sẽ thấy thách đấu trong tab &quot;Nhận được&quot; và có thể accept/decline.
                  Sau khi accept, trận sẽ tự chạy khi backend online.
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Tab: Nhận được ─────────────────────────────────────────────────── */}
        {tab === "received" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1a1e29]">
                Lời thách đấu nhận được
              </h2>
              <button
                onClick={loadChallenges}
                disabled={loadingChallenges}
                className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#253B80] disabled:opacity-50"
              >
                🔄 Làm mới
              </button>
            </div>

            {loadingChallenges ? <Spinner /> : received.length === 0 ? (
              <EmptyState text="Chưa có lời thách đấu nào." />
            ) : (
              <div className="space-y-3">
                {received.map(c => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    role="opponent"
                    respondingId={respondingId}
                    backendOnline={backendOnline === true}
                    processingPending={processingPending}
                    onRespond={respond}
                    onProcessPending={processPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Đã gửi ────────────────────────────────────────────────────── */}
        {tab === "sent" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1a1e29]">Lời thách đấu đã gửi</h2>
              <button
                onClick={loadChallenges}
                disabled={loadingChallenges}
                className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#253B80] disabled:opacity-50"
              >
                🔄 Làm mới
              </button>
            </div>

            {loadingChallenges ? <Spinner /> : sent.length === 0 ? (
              <EmptyState text="Chưa gửi lời thách đấu nào." />
            ) : (
              <div className="space-y-3">
                {sent.map(c => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    role="challenger"
                    respondingId={respondingId}
                    backendOnline={backendOnline === true}
                    processingPending={processingPending}
                    onRespond={respond}
                    onProcessPending={processPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Lịch sử ───────────────────────────────────────────────────── */}
        {tab === "history" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1a1e29]">Lịch sử trận đối kháng</h2>
              <button
                onClick={loadMatches}
                disabled={loadingMatches}
                className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#253B80] disabled:opacity-50"
              >
                🔄 Làm mới
              </button>
            </div>

            {loadingMatches ? <Spinner /> : matches.length === 0 ? (
              <EmptyState text="Chưa có trận đối kháng nào." />
            ) : (
              <div className="overflow-hidden rounded-none border border-[#ded8d3] bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#ded8d3] bg-stone-50 text-left text-xs font-bold text-slate-600">
                      <th className="px-4 py-3">Agent 1 🟦</th>
                      <th className="px-3 py-3 text-center">vs</th>
                      <th className="px-4 py-3">Agent 2 🟥</th>
                      <th className="px-4 py-3">Kết quả</th>
                      <th className="px-4 py-3">Trạng thái</th>
                      <th className="px-4 py-3 text-right">Thời gian</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ded8d3]">
                    {matches.map(m => (
                      <tr key={m.id} className="hover:bg-stone-50">
                        <td className="px-4 py-2.5">
                          <span className="font-bold text-[#253B80]">{m.agent1_name}</span>
                          <p className="text-[11px] text-slate-500">@{m.agent1_username}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-slate-400">vs</td>
                        <td className="px-4 py-2.5">
                          <span className="font-bold text-rose-700">{m.agent2_name}</span>
                          <p className="text-[11px] text-slate-500">@{m.agent2_username}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {m.pending_backend && m.status === "scheduled" ? (
                            <span className="font-bold text-amber-600">⏳ Chờ backend</span>
                          ) : m.is_infra_error ? (
                            <span className="font-bold text-rose-600">⚠️ Lỗi</span>
                          ) : m.winner_name ? (
                            <span className="font-bold text-amber-700">🏆 {m.winner_name}</span>
                          ) : m.outcome === "draw" ? (
                            <span className="font-bold text-slate-600">🤝 Hòa</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-none border px-2 py-0.5 text-[11px] font-bold ${
                            MATCH_STATUS_BADGE[m.status] ?? "bg-slate-100 text-slate-700"
                          }`}>
                            {m.pending_backend ? "pending" : m.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[11px] text-slate-500">
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
        )}
      </main>
    </div>
  );
}

// ─── ChallengeCard ────────────────────────────────────────────────────────────

function ChallengeCard({
  challenge,
  role,
  respondingId,
  backendOnline,
  processingPending,
  onRespond,
  onProcessPending,
}: {
  challenge: Challenge;
  role: "challenger" | "opponent";
  respondingId: number | null;
  backendOnline: boolean;
  processingPending: boolean;
  onRespond: (id: number, action: "accept" | "decline") => void;
  onProcessPending: (matchId?: number) => void;
}) {
  const isResponding = respondingId === challenge.id;
  const isPending = challenge.status === "pending";
  const isAccepted = challenge.status === "accepted";

  const matchPending = isAccepted &&
    challenge.match_pending_backend &&
    challenge.match_status === "scheduled";

  const matchDone = isAccepted && challenge.match_status === "finished";

  return (
    <div className={`rounded-none border bg-white shadow-sm ${
      isPending && role === "opponent"
        ? "border-amber-300"
        : "border-[#ded8d3]"
    }`}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`rounded-none border px-2 py-0.5 text-[11px] font-bold ${
                CHALLENGE_STATUS_BADGE[challenge.status]
              }`}>
                {challenge.status}
              </span>
              {isPending && role === "opponent" && (
                <span className="text-[11px] font-bold text-amber-700 animate-pulse">
                  ● Đang chờ phản hồi của bạn
                </span>
              )}
              {matchPending && (
                <span className="text-[11px] font-bold text-amber-600">
                  ⏳ Chờ backend online để chạy
                </span>
              )}
              {matchDone && (
                <span className="text-[11px] font-bold text-emerald-700">
                  ✅ Trận đã hoàn thành
                </span>
              )}
            </div>

            {/* Matchup */}
            <div className="mt-2 flex items-center gap-2 font-mono text-xs flex-wrap">
              <span>
                <span className="font-bold text-[#253B80]">{challenge.challenger_agent_name}</span>
                <span className="text-slate-400"> (@{challenge.challenger_username})</span>
              </span>
              <span className="text-slate-400">vs</span>
              <span>
                <span className="font-bold text-rose-700">{challenge.opponent_agent_name}</span>
                <span className="text-slate-400"> (@{challenge.opponent_username})</span>
              </span>
            </div>

            {challenge.message && (
              <p className="mt-1.5 text-xs text-slate-600 italic">
                💬 &quot;{challenge.message}&quot;
              </p>
            )}

            <p className="mt-1 text-[11px] text-slate-400">
              Gửi lúc {new Date(challenge.created_at).toLocaleString("vi-VN")}
              {isPending && ` · Hết hạn ${new Date(challenge.expires_at).toLocaleDateString("vi-VN")}`}
            </p>
          </div>

          {/* Result (nếu có) */}
          {matchDone && challenge.match_outcome && (
            <div className="text-right shrink-0">
              <p className="text-xs font-bold text-amber-700">
                {challenge.match_winner_name
                  ? `🏆 ${challenge.match_winner_name}`
                  : challenge.match_outcome === "draw"
                  ? "🤝 Hòa"
                  : OUTCOME_LABEL[challenge.match_outcome]}
              </p>
              {challenge.match_total_moves && (
                <p className="text-[11px] text-slate-500">{challenge.match_total_moves} nước</p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Opponent: accept/decline khi pending */}
          {role === "opponent" && isPending && (
            <>
              <button
                onClick={() => onRespond(challenge.id, "accept")}
                disabled={isResponding}
                className="cursor-pointer rounded-none bg-emerald-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {isResponding ? "..." : "✅ Chấp nhận"}
              </button>
              <button
                onClick={() => onRespond(challenge.id, "decline")}
                disabled={isResponding}
                className="cursor-pointer rounded-none border border-rose-300 bg-rose-50 px-4 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                {isResponding ? "..." : "✗ Từ chối"}
              </button>
            </>
          )}

          {/* Nếu pending_backend + backend online → kích hoạt chạy */}
          {matchPending && backendOnline && challenge.friendly_match_id && (
            <button
              onClick={() => onProcessPending(challenge.friendly_match_id!)}
              disabled={processingPending}
              className="cursor-pointer rounded-none bg-[#253B80] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#1d2e66] disabled:opacity-50"
            >
              {processingPending ? "⏳ Đang chạy..." : "▶ Chạy ngay"}
            </button>
          )}
          {matchPending && !backendOnline && (
            <span className="text-[11px] text-amber-600 italic">
              Backend offline — sẽ tự chạy khi backend online
            </span>
          )}

          {/* Replay */}
          {matchDone && challenge.friendly_match_id && (
            <Link
              href={`/arena/replay/friendly/${challenge.friendly_match_id}`}
              className="rounded-none border border-[#253B80] px-4 py-1.5 text-xs font-bold text-[#253B80] hover:bg-[#253B80] hover:text-white transition"
            >
              ▶ Xem Replay
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-none border border-[#ded8d3] bg-white py-12 text-center">
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}
