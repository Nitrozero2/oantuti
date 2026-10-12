import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neon Auth",
  description: "Simple registration and login with Neon PostgreSQL",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
