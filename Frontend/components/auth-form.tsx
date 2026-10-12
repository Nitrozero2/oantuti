"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || "Có lỗi xảy ra. Vui lòng thử lại.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setMessage("Không thể kết nối máy chủ. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-300";

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-5">
      <label className="block text-sm font-medium text-slate-200">
        Tên đăng nhập
        <input
          className={inputClass}
          type="text"
          autoComplete="username"
          required
          minLength={3}
          maxLength={32}
          pattern="[a-zA-Z0-9_]+"
          title="Chỉ dùng chữ cái, số và dấu gạch dưới"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="vd: nguyen_van_a"
        />
      </label>
      <label className="block text-sm font-medium text-slate-200">
        Mật khẩu
        <input
          className={inputClass}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={8}
          maxLength={72}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Ít nhất 8 ký tự"
        />
      </label>
      {message && (
        <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {message}
        </p>
      )}
      <button
        disabled={busy}
        className="w-full rounded-xl bg-indigo-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Đang xử lý..." : mode === "login" ? "Đăng nhập" : "Đăng ký"}
      </button>
    </form>
  );
}
