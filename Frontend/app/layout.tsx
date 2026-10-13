import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const lato = localFont({
  src: [
    {
      path: "../source/fonts/Lato-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../source/fonts/Lato-Italic.ttf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../source/fonts/Lato-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-lato",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#253B80",
};

export const metadata: Metadata = {
  title: "OTTv2 Arena - Oẳn Tù Tì v2",
  description: "Nền tảng thi đấu cờ Oẳn Tù Tì v2 tự động bằng AI",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={lato.variable}>
      <body className={lato.className}>{children}</body>
    </html>
  );
}
