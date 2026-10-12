"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Setting = {
  key: string;
  value: string;
  updated_at: string;
  updated_by_username: string | null;
};

type TestResult = "idle" | "testing" | "online" | "offline";

export default function AdminSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);

  // backend_url form state
  const [backendUrl, setBackendUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testResult, setTestResult] = useState<TestResult>("idle");

  // Load settings
  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => {
        if (r.status === 401 || r.status === 403) { router.push("/login"); return null; }
        return r.json();
      })
      .then((d: { settings?: Setting[] } | null) => {
        if (!d) return;
        setSettings(d.settings ?? []);
        const bu = d.settings?.find(s => s.key === "backend_url");
        if (bu) setBackendUrl(bu.value);
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    setTestResult("idle");

    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "backend_url", value: backendUrl }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; online?: boolean };

      if (!res.ok || !data.ok) {
        setSaveMsg({ ok: false, text: data.error ?? "Lỗi khi lưu." });
      } else {
        // API trả về kết quả test kết nối luôn
        setTestResult(data.online ? "online" : "offline");
        setSaveMsg({
          ok: true,
          text: data.online
            ? "✅ Đã lưu & kết nối thành công! Cache sẽ cập nhật trong 60 giây."
            : "💾 Đã lưu. Nhưng backend chưa phản hồi — kiểm tra tunnel đang chạy chưa.",
        });
        // Refresh settings list
        const r2 = await fetch("/api/admin/settings");
        const d2 = await r2.json() as { settings?: Setting[] };
        setSettings(d2.settings ?? []);
      }
    } catch {
      setSaveMsg({ ok: false, text: "Lỗi mạng." });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!backendUrl) return;
    setTestResult("testing");
    try {
      // Test qua backend-status endpoint (dùng URL đang nhập, chưa lưu)
      // Gọi trực tiếp từ browser đến URL tunnel để test
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${backendUrl.replace(/\/+$/, "")}/health`, {
        signal: controller.signal,
        mode: "cors",
      });
      setTestResult(res.ok ? "online" : "offline");
    } catch {
      setTestResult("offline");
    }
  }

  const currentSetting = settings.find(s => s.key === "backend_url");

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-2xl">

        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
          <span className="text-slate-700">/</span>
          <Link href="/admin/tournament" className="hover:text-white">Admin</Link>
          <span className="text-slate-700">/</span>
          <span className="text-white">Settings</span>
        </div>

        <h1 className="mb-1 text-3xl font-bold">⚙️ Cài đặt hệ thống</h1>
        <p className="mb-8 text-sm text-slate-400">
          Cập nhật URL backend mà không cần redeploy Vercel.
        </p>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
          </div>
        ) : (
          <div className="space-y-6">

            {/* Backend URL card */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-white">🌐 Backend URL</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    URL của máy chủ FastAPI (Cloudflare Tunnel). Thay đổi sẽ có hiệu lực
                    trong vòng <span className="text-indigo-300 font-medium">60 giây</span> trên toàn bộ Vercel.
                  </p>
                </div>
                {/* Status dot */}
                {testResult !== "idle" && (
                  <div className={`mt-1 shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                    testResult === "testing" ? "bg-yellow-400/10 text-yellow-300" :
                    testResult === "online"  ? "bg-emerald-400/10 text-emerald-300" :
                                               "bg-rose-400/10 text-rose-300"
                  }`}>
                    {testResult === "testing" && (
                      <span className="h-2 w-2 animate-spin rounded-full border border-yellow-300 border-t-transparent" />
                    )}
                    {testResult === "online"  && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                    {testResult === "offline" && <span className="h-2 w-2 rounded-full bg-rose-400" />}
                    {testResult === "testing" ? "Đang test..." :
                     testResult === "online"  ? "Online" : "Offline"}
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input
                  type="url"
                  value={backendUrl}
                  onChange={e => { setBackendUrl(e.target.value); setTestResult("idle"); setSaveMsg(null); }}
                  placeholder="https://xxxx-xxxx.trycloudflare.com"
                  className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-indigo-400/50"
                />
                <button
                  onClick={handleTest}
                  disabled={!backendUrl || testResult === "testing"}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  title="Test kết nối (chưa lưu)"
                >
                  🔌 Test
                </button>
              </div>

              {/* Save button + message */}
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Đang lưu..." : "💾 Lưu & Test"}
                </button>
                {saveMsg && (
                  <p className={`text-xs ${saveMsg.ok ? "text-emerald-300" : "text-rose-300"}`}>
                    {saveMsg.text}
                  </p>
                )}
              </div>

              {/* Current saved value */}
              {currentSetting && (
                <div className="mt-4 rounded-xl border border-white/5 bg-black/20 px-4 py-3 text-xs text-slate-500">
                  <p>
                    <span className="text-slate-400">Giá trị đang dùng:</span>{" "}
                    {currentSetting.value
                      ? <span className="font-mono text-teal-400">{currentSetting.value}</span>
                      : <span className="italic text-slate-600">(trống — dùng env var)</span>
                    }
                  </p>
                  {currentSetting.updated_at && (
                    <p className="mt-1">
                      Cập nhật lúc {new Date(currentSetting.updated_at).toLocaleString("vi-VN")}
                      {currentSetting.updated_by_username && ` bởi @${currentSetting.updated_by_username}`}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* How it works */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-400">
              <p className="mb-3 font-semibold text-slate-200 text-xs uppercase tracking-widest">📋 Quy trình sử dụng</p>
              <ol className="space-y-2 list-decimal list-inside">
                <li>Bật máy cá nhân → chạy <code className="rounded bg-black/30 px-1.5 py-0.5 text-teal-400 text-xs">./tunnel.sh</code></li>
                <li>Copy URL tunnel (<code className="rounded bg-black/30 px-1.5 py-0.5 text-teal-400 text-xs">https://xxxx.trycloudflare.com</code>)</li>
                <li>Dán vào ô trên → nhấn <strong className="text-white">Lưu & Test</strong></li>
                <li>Tính năng đấu trận, validate agent sẽ hoạt động ngay trong ≤ 60s</li>
                <li>Khi tắt máy → tính năng trở về trạng thái offline tự nhiên, không cần làm gì</li>
              </ol>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
