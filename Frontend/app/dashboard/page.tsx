import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Navbar from "@/components/Navbar";
import leaderboardImg from "@/source/images/leaderboard.png";
import submitImg from "@/source/images/submit.png";
import competeImg from "@/source/images/compete.png";

export const runtime = "nodejs";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const features = [
    {
      title: "Bảng Xếp Hạng",
      description: "Theo dõi thứ hạng ELO, vinh danh các cao thủ và xem lại các ván đấu đỉnh cao.",
      href: "/arena/leaderboard",
      image: leaderboardImg,
    },
    {
      title: "Nộp Agent",
      description: "Viết code bot Python trực tiếp, kiểm tra tính hợp lệ và đưa agent vào đấu trường.",
      href: "/arena/submit",
      image: submitImg,
    },
    {
      title: "Đấu Đối Kháng",
      description: "Chọn hai agent bất kỳ để so tài trực tiếp trên bàn cờ 9x9 không tính điểm rank.",
      href: "/arena/friendly",
      image: competeImg,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F5F0ED]">
      {/* ─── THANH HEADER TRÊN CÙNG ───────────────────────────────────── */}
      <Navbar initialUser={session} />

      {/* ─── NỘI DUNG CHÍNH: 3 Ô TÍNH NĂNG KHUNG THẲNG ĐỐI XỨNG ───────── */}
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-6xl flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
        {/* Lưới 3 ô tính năng kích thước bằng nhau, khung thẳng, đối xứng qua trục dọc */}
        <div className="grid grid-cols-1 items-stretch gap-6 sm:gap-8 md:grid-cols-3">
          {features.map((feature) => (
            <Link
              key={feature.href}
              href={feature.href}
              className="group flex flex-col overflow-hidden rounded-none border border-[#ded8d3] bg-white p-4 shadow-md transition-all duration-300 hover:-translate-y-1.5 hover:border-[#253B80] hover:shadow-xl hover:shadow-[#253B80]/15"
            >
              {/* Ảnh ở phía trên: Khung thẳng */}
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-none bg-stone-100 border border-[#ded8d3]">
                <Image
                  src={feature.image}
                  alt={feature.title}
                  priority
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>

              {/* Tính năng ở phía dưới: Khi di chuột thì thay tên bằng mô tả */}
              <div className="relative flex min-h-[84px] w-full items-center justify-center p-3 text-center">
                {/* Tên tính năng (mặc định hiện, hover ẩn) */}
                <h3 className="text-xl font-bold tracking-tight text-[#1a1e29] transition-all duration-300 group-hover:invisible group-hover:scale-90 group-hover:opacity-0">
                  {feature.title}
                </h3>

                {/* Mô tả tính năng (mặc định ẩn, hover hiện thay thế) */}
                <p className="absolute inset-x-3 text-sm font-medium leading-relaxed text-[#253B80] opacity-0 scale-95 invisible transition-all duration-300 group-hover:visible group-hover:scale-100 group-hover:opacity-100">
                  {feature.description}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {/* ─── KHU VỰC DÀNH CHO ADMIN (NẾU CÓ) ─────────────────────────── */}
        {session.is_admin && (
          <section className="mt-12 w-full rounded-none border border-[#ded8d3] bg-white p-6 shadow-md sm:p-7">
            <div className="mb-4 flex items-center justify-between border-b border-[#ded8d3] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-rose-700">🛠 Quản Trị Hệ Thống (Admin)</span>
                <span className="rounded-none bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-300">
                  Chỉ định cho Admin
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Link
                href="/admin/tournament"
                className="flex flex-col items-center gap-1.5 rounded-none border border-[#ded8d3] bg-[#F5F0ED]/50 p-3.5 text-center transition hover:border-[#253B80] hover:bg-[#253B80]/5"
              >
                <span className="text-xl">🎮</span>
                <span className="text-xs font-bold text-[#1a1e29]">Tournament</span>
                <span className="text-[10px] text-slate-500">Bật/tắt worker giải</span>
              </Link>

              <Link
                href="/admin/agents"
                className="flex flex-col items-center gap-1.5 rounded-none border border-[#ded8d3] bg-[#F5F0ED]/50 p-3.5 text-center transition hover:border-[#253B80] hover:bg-[#253B80]/5"
              >
                <span className="text-xl">🤖</span>
                <span className="text-xs font-bold text-[#1a1e29]">Duyệt Agent</span>
                <span className="text-[10px] text-slate-500">Xem xét & kích hoạt</span>
              </Link>

              <Link
                href="/admin/settings"
                className="flex flex-col items-center gap-1.5 rounded-none border border-[#ded8d3] bg-[#F5F0ED]/50 p-3.5 text-center transition hover:border-[#253B80] hover:bg-[#253B80]/5"
              >
                <span className="text-xl">⚙️</span>
                <span className="text-xs font-bold text-[#1a1e29]">Cài Đặt</span>
                <span className="text-[10px] text-slate-500">Backend Tunnel URL</span>
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
