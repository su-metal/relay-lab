import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "relay-lab",
  description: "実メーカー・実型番・実端子番号でリレー回路を配線するシミュレーター",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
