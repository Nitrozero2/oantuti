import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="w-full max-w-md rounded-3xl border border-rose-400/20 bg-rose-400/5 p-8 text-center shadow-2xl sm:p-12">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-rose-400/10 text-4xl">
          🚫
        </div>
        <h1 className="text-3xl font-bold text-rose-300 sm:text-4xl">403</h1>
        <p className="mt-2 text-xl font-semibold text-white">Không có quyền truy cập</p>
        <p className="mt-4 text-slate-400">
          Trang này chỉ dành cho tài khoản <span className="font-semibold text-rose-300">admin</span>.
          Vui lòng đăng nhập bằng tài khoản có quyền admin.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            className="rounded-xl border border-white/15 px-6 py-3 text-center font-semibold transition hover:bg-white/5"
          >
            ← Dashboard
          </Link>
          <Link
            href="/login"
            className="rounded-xl bg-indigo-500 px-6 py-3 text-center font-semibold text-white transition hover:bg-indigo-400"
          >
            Đăng nhập tài khoản khác
          </Link>
        </div>
      </section>
    </main>
  );
}
