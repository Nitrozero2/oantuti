"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

const AGENT_TEMPLATE = `import random

def agent(observation, configuration):
    """
    Agent thi đấu OTTv2 Arena.

    observation:
      - valid_moves: list[{from_col, from_row, to_col, to_row, is_capture}]
      - board: list[81] → None hoặc {player: 1|2, type: "ROCK"|"PAPER"|"SCISSORS"}
      - current_player: 1 hoặc 2
      - piece_counts: {"1": {ROCK:n,...}, "2": {...}}
      - move_count: int

    Trả về: {from_col, from_row, to_col, to_row} hoặc None
    """
    moves = observation.get("valid_moves", [])
    if not moves:
        return None
    move = random.choice(moves)
    return {"from_col": move["from_col"], "from_row": move["from_row"],
            "to_col": move["to_col"], "to_row": move["to_row"]}
`;

type AgentInfo = {
  id: number; agent_name: string; description: string; code: string;
  version: number; status: string; validation_error: string | null;
  is_active: boolean; elo: number; wins: number; losses: number; draws: number; submitted_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-400/20 text-emerald-300",
  pending: "bg-slate-400/20 text-slate-300",
  validating: "bg-yellow-400/20 text-yellow-300",
  rejected: "bg-rose-400/20 text-rose-300",
};

export default function ArenaSubmitPage() {
  const [agentName, setAgentName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState(AGENT_TEMPLATE);
  const [validating, setValidating] = useState(false);
  const [validResult, setValidResult] = useState<{ valid: boolean; error?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [nextVersion, setNextVersion] = useState<number | null>(null);
  const router = useRouter();

  async function handleValidate() {
    setValidating(true);
    setValidResult(null);
    try {
      const res = await fetch("/api/arena/agents/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json() as { valid: boolean; error?: string };
      setValidResult(data);
    } catch { setValidResult({ valid: false, error: "Không thể kết nối backend." }); }
    finally { setValidating(false); }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(""); setSuccess(false); setSubmitting(true);
    try {
      const res = await fetch("/api/arena/agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_name: agentName, description, code }),
      });
      const data = await res.json() as { ok?: boolean; agent_id?: number; agent_name?: string; version?: number; error?: string };
      if (!res.ok) {
        if (res.status === 401) { router.push("/login"); return; }
        setMessage(data.error ?? "Có lỗi xảy ra."); return;
      }
      setSuccess(true);
      setMessage(`✅ Agent "${data.agent_name}" v${data.version} đã nộp. Chờ admin duyệt.`);
      setAgentName(""); setDescription(""); setCode(AGENT_TEMPLATE);
      setValidResult(null); setAgents(null);
    } catch { setMessage("Không thể kết nối máy chủ."); }
    finally { setSubmitting(false); }
  }

  async function loadAgents() {
    setLoadingAgents(true);
    try {
      const res = await fetch("/api/arena/agents");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json() as { agents?: AgentInfo[] };
      if (data.agents) {
        setAgents(data.agents);
        const maxVer = Math.max(0, ...data.agents.map(a => a.version));
        setNextVersion(maxVer + 1);
      }
    } finally { setLoadingAgents(false); }
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">← Dashboard</Link>
          <span className="text-slate-700">/</span>
          <Link href="/arena/leaderboard" className="text-sm text-slate-400 hover:text-white">Leaderboard</Link>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold">🤖 Nộp Agent</h1>
          <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-0.5 text-xs font-semibold text-indigo-300">Arena</span>
        </div>
        <p className="text-slate-400 mb-6">Viết agent Python để tham gia OTTv2 Arena. Agent cần được admin duyệt trước khi thi đấu.</p>

        {/* Rules */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-2 text-sm font-semibold text-slate-300">📖 Yêu cầu</p>
          <ul className="space-y-1 text-xs text-slate-400">
            <li>• Bàn cờ 9×9. Quân: ✊ ROCK &gt; ✌️ SCISSORS, ✋ PAPER &gt; ✊ ROCK, ✌️ SCISSORS &gt; ✋ PAPER</li>
            <li>• P1 (Xanh) thắng khi đến i9 hoặc diệt hết 1 loại quân P2. P2 ngược lại.</li>
            <li>• Hàm <code className="text-indigo-300">def agent(observation, configuration)</code> bắt buộc.</li>
            <li>• Chạy trên Judge0 (Python 3). Timeout 10s/nước. Code tối đa 65,536 ký tự.</li>
          </ul>
        </div>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl sm:p-8">
          <div className="space-y-5">
            <label className="block text-sm font-medium text-slate-200">
              Tên agent
              {nextVersion && <span className="ml-2 text-xs text-slate-500 font-normal">(sẽ là v{nextVersion})</span>}
              <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-300"
                type="text" required maxLength={100} value={agentName}
                onChange={e => setAgentName(e.target.value)} placeholder="vd: MyGreedyBot v2"
              />
            </label>

            <label className="block text-sm font-medium text-slate-200">
              Mô tả <span className="text-slate-500 font-normal">(không bắt buộc)</span>
              <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-300"
                type="text" maxLength={200} value={description}
                onChange={e => setDescription(e.target.value)} placeholder="Mô tả chiến thuật..."
              />
            </label>

            <div className="text-sm font-medium text-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span>Code agent</span>
                <span className="text-xs text-slate-500 font-normal">{code.length.toLocaleString()} / 65,536</span>
              </div>
              <div className="rounded-xl overflow-hidden border border-white/10">
                <CodeMirror value={code} height="400px" extensions={[python()]} theme={oneDark}
                  onChange={val => { setCode(val); setValidResult(null); }}
                  basicSetup={{ lineNumbers: true, syntaxHighlighting: true, autocompletion: true, bracketMatching: true, indentOnInput: true }}
                />
              </div>
            </div>

            {/* Validate button */}
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={handleValidate} disabled={validating || code.trim().length < 10}
                className="rounded-xl border border-teal-400/30 px-4 py-2 text-sm font-semibold text-teal-300 hover:bg-teal-400/10 transition disabled:opacity-60">
                {validating ? "⏳ Đang kiểm tra..." : "🔍 Kiểm tra trước khi nộp"}
              </button>
              {validResult && (
                <div className={`rounded-lg px-3 py-1.5 text-sm ${validResult.valid ? "bg-emerald-400/10 text-emerald-300 border border-emerald-400/20" : "bg-rose-400/10 text-rose-300 border border-rose-400/20"}`}>
                  {validResult.valid ? "✅ Agent hợp lệ" : `❌ ${validResult.error}`}
                </div>
              )}
            </div>

            {message && (
              <p role="alert" className={`rounded-lg border px-3 py-2 text-sm ${success ? "border-teal-400/20 bg-teal-400/10 text-teal-200" : "border-rose-400/20 bg-rose-400/10 text-rose-200"}`}>
                {message}
              </p>
            )}

            <button type="submit" disabled={submitting || code.trim().length === 0}
              className="w-full rounded-xl bg-indigo-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-indigo-300 disabled:opacity-60 disabled:cursor-not-allowed">
              {submitting ? "Đang nộp..." : "🚀 Nộp agent vào Arena"}
            </button>
          </div>
        </form>

        {/* My agents */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Lịch sử agent của tôi</h2>
            <button onClick={loadAgents} disabled={loadingAgents}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium hover:bg-white/5 disabled:opacity-60 transition">
              {loadingAgents ? "Đang tải..." : "Tải lịch sử"}
            </button>
          </div>

          {agents === null && !loadingAgents && <p className="text-sm text-slate-500">Nhấn &quot;Tải lịch sử&quot; để xem.</p>}
          {agents !== null && agents.length === 0 && <p className="text-sm text-slate-500">Bạn chưa nộp agent nào.</p>}
          {agents !== null && agents.length > 0 && (
            <div className="space-y-3">
              {agents.map(a => (
                <div key={a.id} className={`rounded-2xl border p-4 ${a.is_active ? "border-indigo-400/30 bg-indigo-400/5" : "border-white/10 bg-black/20"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/arena/agents/${a.id}`} className="font-semibold hover:text-indigo-300 transition">{a.agent_name}</Link>
                        <span className="text-xs text-slate-500">v{a.version}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[a.status] ?? "bg-slate-400/20 text-slate-300"}`}>{a.status}</span>
                        {a.is_active && <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300">Active</span>}
                      </div>
                      {a.validation_error && <p className="mt-1 text-xs text-rose-300">❌ {a.validation_error}</p>}
                      {a.description && <p className="text-xs text-slate-400 mt-0.5">{a.description}</p>}
                      <div className="mt-1.5 flex gap-4 text-xs text-slate-500">
                        <span>ELO: <span className="font-mono font-bold text-slate-300">{a.elo}</span></span>
                        <span className="text-emerald-400">W:{a.wins}</span>
                        <span className="text-rose-400">L:{a.losses}</span>
                        <span className="text-slate-400">D:{a.draws}</span>
                        <span>{new Date(a.submitted_at).toLocaleDateString("vi-VN")}</span>
                      </div>
                    </div>
                    <button onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                      className="shrink-0 rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/5 transition">
                      {expandedId === a.id ? "Ẩn" : "Xem code"}
                    </button>
                  </div>
                  {expandedId === a.id && (
                    <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
                      <CodeMirror value={a.code ?? ""} extensions={[python()]} theme={oneDark}
                        editable={false} basicSetup={{ lineNumbers: true, syntaxHighlighting: true }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
