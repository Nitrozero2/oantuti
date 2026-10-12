import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AuthForm from "@/components/auth-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl sm:p-10">
        <Link href="/" className="text-sm text-slate-400 hover:text-white">← Trang chủ</Link>
        <h1 className="mt-7 text-3xl font-bold">Đăng nhập</h1>
        <p className="mt-2 text-sm text-slate-400">Nhập tên đăng nhập và mật khẩu của bạn.</p>
        <AuthForm mode="login" />
        <p className="mt-6 text-center text-sm text-slate-400">Chưa có tài khoản? <Link className="font-semibold text-indigo-300 hover:text-indigo-200" href="/register">Đăng ký</Link></p>
      </section>
    </main>
  );
}
