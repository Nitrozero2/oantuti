import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-[#F5F0ED] text-[#1a1e29]">
      <Navbar />

      <main className="flex min-h-[70vh] items-center justify-center px-5 py-12">
        <section className="w-full max-w-md rounded-none border border-[#ded8d3] bg-white p-8 text-center shadow-md sm:p-10">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-none border border-rose-300 bg-rose-50 text-3xl">
            🚫
          </div>
          <h1 className="text-3xl font-extrabold text-rose-700 sm:text-4xl">403</h1>
          <p className="mt-2 text-lg font-bold text-[#1a1e29]">Không có quyền truy cập</p>
          <p className="mt-3 text-sm text-slate-600">
            Trang này chỉ dành cho tài khoản <span className="font-bold text-rose-700">admin</span>.
            Vui lòng đăng nhập bằng tài khoản có quyền admin.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/dashboard"
              className="rounded-none border border-[#ded8d3] bg-white px-5 py-2.5 text-xs font-bold text-slate-700 transition hover:border-[#253B80] hover:text-[#253B80]"
            >
              ← Về Dashboard
            </Link>
            <Link
              href="/login"
              className="rounded-none bg-[#253B80] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d2e66]"
            >
              Đăng nhập tài khoản khác
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
