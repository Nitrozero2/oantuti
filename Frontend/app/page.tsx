import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-indigo-950/30 sm:p-12">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-300/10 px-3 py-1 text-sm text-indigo-200">
          <span className="h-2 w-2 rounded-full bg-teal-300" /> Next.js + Neon PostgreSQL
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Xin chào 👋</h1>
        <p className="mt-4 max-w-md leading-7 text-slate-300">
          Một website mẫu có đăng ký, đăng nhập và trang tài khoản. Dữ liệu được lưu trong PostgreSQL trên Neon.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link className="rounded-xl bg-indigo-400 px-6 py-3 text-center font-semibold text-slate-950 transition hover:bg-indigo-300" href="/register">Tạo tài khoản</Link>
          <Link className="rounded-xl border border-white/15 px-6 py-3 text-center font-semibold hover:bg-white/5" href="/login">Đăng nhập</Link>
        </div>
        <p className="mt-8 text-xs leading-5 text-slate-500">Demo nền tảng: Vercel · Neon · PostgreSQL</p>
      </section>
    </main>
  );
}
