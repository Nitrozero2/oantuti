import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LogoutButton from "@/components/logout-button";

export const runtime = "nodejs";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl sm:p-12">
        <div className="text-sm font-semibold text-teal-300">ĐĂNG NHẬP THÀNH CÔNG</div>
        <h1 className="mt-4 text-3xl font-bold sm:text-4xl">
          Xin chào, {session.username} 👋
          {session.is_admin && (
            <span className="ml-3 rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-sm font-semibold text-rose-300 align-middle">
              Admin
            </span>
          )}
        </h1>
        <p className="mt-3 text-slate-300">Chọn một trong các tính năng bên dưới để bắt đầu.</p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
          <p className="text-xs text-slate-500">Tài khoản</p>
          <p className="mt-1 text-lg font-medium">{session.username}</p>
          <p className="mt-1 text-xs text-slate-500">User ID: {session.id}</p>
        </div>

        {/* Section: Arena (OTTv2) */}
        <div className="mt-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-indigo-400">
            ⚔️ OTTv2 Arena
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              href="/arena/leaderboard"
              className="group flex flex-col gap-3 rounded-2xl border border-yellow-300/20 bg-yellow-300/5 p-5 transition hover:border-yellow-300/40 hover:bg-yellow-300/10"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-400/20 text-xl">
                🏆
              </div>
              <div>
                <p className="font-semibold text-yellow-200">Bảng Xếp Hạng</p>
                <p className="mt-1 text-xs text-slate-400">ELO ranking giống Kaggle ConnectX.</p>
              </div>
            </Link>

            <Link
              href="/arena/submit"
              className="group flex flex-col gap-3 rounded-2xl border border-indigo-300/20 bg-indigo-300/5 p-5 transition hover:border-indigo-300/40 hover:bg-indigo-300/10"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-400/20 text-xl">
                🤖
              </div>
              <div>
                <p className="font-semibold text-indigo-200">Nộp Agent</p>
                <p className="mt-1 text-xs text-slate-400">Nộp agent Python để thi đấu Arena.</p>
              </div>
            </Link>

            <Link
              href="/arena/friendly"
              className="group flex flex-col gap-3 rounded-2xl border border-teal-300/20 bg-teal-300/5 p-5 transition hover:border-teal-300/40 hover:bg-teal-300/10"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/20 text-xl">
                ⚔️
              </div>
              <div>
                <p className="font-semibold text-teal-200">Đấu Đối Kháng Riêng</p>
                <p className="mt-1 text-xs text-slate-400">Chọn hai agent để đấu thử, không tính ELO.</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Section: Admin — chỉ hiện với is_admin */}
        {session.is_admin && (
          <div className="mt-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-rose-400">
              🛠 Admin
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link
                href="/admin/tournament"
                className="group flex flex-col gap-3 rounded-2xl border border-purple-300/20 bg-purple-300/5 p-5 transition hover:border-purple-300/40 hover:bg-purple-300/10"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-400/20 text-xl">
                  🎮
                </div>
                <div>
                  <p className="font-semibold text-purple-200">Tournament Control</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Bật, tạm dừng, tiếp tục, dừng ghép trận.
                  </p>
                </div>
              </Link>

              <Link
                href="/admin/agents"
                className="group flex flex-col gap-3 rounded-2xl border border-orange-300/20 bg-orange-300/5 p-5 transition hover:border-orange-300/40 hover:bg-orange-300/10"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-400/20 text-xl">
                  🤖
                </div>
                <div>
                  <p className="font-semibold text-orange-200">Duyệt Agent</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Xem xét, validate và kích hoạt agent.
                  </p>
                </div>
              </Link>

              <Link
                href="/admin/match"
                className="group flex flex-col gap-3 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-5 transition hover:border-rose-300/40 hover:bg-rose-300/10"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-400/20 text-xl">
                  ⚔️
                </div>
                <div>
                  <p className="font-semibold text-rose-200">Tạo Trận Đấu</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Chọn agent, xem live board theo bước.
                  </p>
                </div>
              </Link>

              <Link
                href="/admin/matches"
                className="group flex flex-col gap-3 rounded-2xl border border-orange-300/20 bg-orange-300/5 p-5 transition hover:border-orange-300/40 hover:bg-orange-300/10"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-400/20 text-xl">
                  📋
                </div>
                <div>
                  <p className="font-semibold text-orange-200">Quản Lý Trận</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Danh sách, xóa, theo dõi trận đấu.
                  </p>
                </div>
              </Link>

              <Link
                href="/admin/settings"
                className="group flex flex-col gap-3 rounded-2xl border border-teal-300/20 bg-teal-300/5 p-5 transition hover:border-teal-300/40 hover:bg-teal-300/10"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/20 text-xl">
                  ⚙️
                </div>
                <div>
                  <p className="font-semibold text-teal-200">Cài Đặt</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Cập nhật Backend URL (tunnel) không cần redeploy.
                  </p>
                </div>
              </Link>
            </div>
          </div>
        )}

        <LogoutButton />
      </section>
    </main>
  );
}
