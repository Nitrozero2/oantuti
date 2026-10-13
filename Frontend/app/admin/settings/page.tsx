"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";

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

  const [backendUrl, setBackendUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testResult, setTestResult] = useState<TestResult>("idle");

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((d: { settings?: Setting[] } | null) => {
        if (!d) return;
        setSettings(d.settings ?? []);
        const bu = d.settings?.find((s) => s.key === "backend_url");
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
      const data = (await res.json()) as { ok?: boolean; error?: string; online?: boolean };

      if (!res.ok || !data.ok) {
        setSaveMsg({ ok: false, text: data.error ?? "Lỗi khi lưu." });
      } else {
        setTestResult(data.online ? "online" : "offline");
        setSaveMsg({
          ok: true,
          text: data.online
            ? "✅ Đã lưu & kết nối thành công! Cache sẽ cập nhật trong 60 giây."
            : "💾 Đã lưu. Nhưng backend chưa phản hồi — kiểm tra tunnel đang chạy chưa.",
        });
        const r2 = await fetch("/api/admin/settings");
        const d2 = (await r2.json()) as { settings?: Setting[] };
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

  const currentSetting = settings.find((s) => s.key === "backend_url");

  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between border-b border-[#ded8d3] pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Link href="/dashboard" className="hover:text-[#253B80]">Dashboard</Link>
            <span>/</span>
            <Link href="/admin/tournament" className="hover:text-[#253B80]">Admin</Link>
            <span>/</span>
            <span className="text-[#1a1e29]">Settings</span>
          </div>
          <span className="rounded-none border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
            Admin Area
          </span>
        </div>

        <h1 className="mb-1 text-3xl font-extrabold text-[#1a1e29]">⚙️ Cài đặt hệ thống</h1>
        <p className="mb-8 text-sm text-slate-600">
          Cập nhật URL backend (Cloudflare Tunnel) mà không cần redeploy lại Vercel.
        </p>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-none border-2 border-stone-300 border-t-[#253B80]" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Backend URL card: Khung thẳng */}
            <div className="rounded-none border border-[#ded8d3] bg-white p-6 shadow-md">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-[#1a1e29]">🌐 Backend URL</h2>
                  <p className="mt-1 text-xs text-slate-600">
                    URL của máy chủ FastAPI (Cloudflare Tunnel). Thay đổi sẽ có hiệu lực
                    trong vòng <span className="font-bold text-[#253B80]">60 giây</span> trên toàn bộ hệ thống.
                  </p>
                </div>
                {testResult !== "idle" && (
                  <div
                    className={`shrink-0 rounded-none border px-3 py-1 text-xs font-bold ${
                      testResult === "testing"
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : testResult === "online"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-rose-300 bg-rose-50 text-rose-800"
                    }`}
                  >
                    {testResult === "testing"
                      ? "⏳ Đang test..."
                      : testResult === "online"
                      ? "🟢 Online"
                      : "🔴 Offline"}
                  </div>
                )}
              </div>

              {/* Input: Khung thẳng */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="url"
                  value={backendUrl}
                  onChange={(e) => {
                    setBackendUrl(e.target.value);
                    setTestResult("idle");
                    setSaveMsg(null);
                  }}
                  placeholder="https://xxxx-xxxx.trycloudflare.com"
                  className="flex-1 rounded-none border border-[#ded8d3] bg-white px-4 py-2.5 text-sm text-[#1a1e29] placeholder-slate-400 outline-none transition focus:border-[#253B80]"
                />
                <button
                  onClick={handleTest}
                  disabled={!backendUrl || testResult === "testing"}
                  className="cursor-pointer rounded-none border border-[#ded8d3] bg-white px-5 py-2.5 text-xs font-bold text-slate-700 transition hover:border-[#253B80] disabled:opacity-40"
                  title="Test kết nối (chưa lưu)"
                >
                  🔌 Test kết nối
                </button>
              </div>

              {/* Save button + message */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="cursor-pointer rounded-none bg-[#253B80] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66] disabled:opacity-50"
                >
                  {saving ? "Đang lưu..." : "💾 Lưu & Kiểm tra"}
                </button>
                {saveMsg && (
                  <p
                    className={`text-xs font-bold ${
                      saveMsg.ok ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {saveMsg.text}
                  </p>
                )}
              </div>

              {/* Current saved value */}
              {currentSetting && (
                <div className="mt-4 rounded-none border border-[#ded8d3] bg-stone-50 px-4 py-3 text-xs text-slate-600">
                  <p>
                    <span className="font-bold text-[#1a1e29]">Giá trị đang dùng:</span>{" "}
                    {currentSetting.value ? (
                      <span className="font-mono font-bold text-[#253B80]">{currentSetting.value}</span>
                    ) : (
                      <span className="italic text-slate-400">(trống — dùng biến môi trường BACKEND_URL)</span>
                    )}
                  </p>
                  {currentSetting.updated_at && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Cập nhật lúc {new Date(currentSetting.updated_at).toLocaleString("vi-VN")}
                      {currentSetting.updated_by_username && ` bởi @${currentSetting.updated_by_username}`}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* How it works */}
            <div className="rounded-none border border-[#ded8d3] bg-white p-5 text-sm text-slate-600 shadow-sm">
              <p className="mb-3 font-bold text-xs uppercase tracking-wider text-[#1a1e29]">
                📋 Quy trình kết nối
              </p>
              <ol className="space-y-2 list-decimal list-inside text-xs leading-relaxed">
                <li>Bật máy cá nhân → chạy script <code className="bg-stone-100 px-1 py-0.5 font-mono text-[#253B80]">./tunnel.sh</code></li>
                <li>Copy URL Cloudflare Tunnel (<code className="bg-stone-100 px-1 py-0.5 font-mono text-[#253B80]">https://xxxx.trycloudflare.com</code>)</li>
                <li>Dán vào ô trên → nhấn <strong className="text-[#1a1e29]">Lưu & Kiểm tra</strong></li>
                <li>Tính năng đấu đối kháng, validate agent trên Vercel sẽ hoạt động ngay</li>
                <li>Khi tắt máy → các tính năng sẽ chuyển về trạng thái offline an toàn mà không bị crash</li>
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
