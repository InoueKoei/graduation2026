import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "消さない組版 — Type Residue",
  description:
    "消された言葉を入力のニュアンスとして余白に残す、文字入力体験のプロトタイプ。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
