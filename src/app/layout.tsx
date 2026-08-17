import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "relay-lab",
  description: "実メーカー・実型番・実端子番号でリレー回路を配線するシミュレーター",
};

/**
 * モバイルの表示領域（design.md §8.12）。
 *
 * - `width: device-width` —— 既定でも入るが、画面の広さで 3 カラムを畳む
 *   判断（`useViewportMode`）の前提なので明示する
 * - `viewportFit: "cover"` —— ノッチのある端末で画面の端まで使う。切り欠きの
 *   避けは `env(safe-area-inset-*)` を使う側（画面下のタブ）で持つ
 * - **拡大は禁止しない。** `maximumScale: 1` は端子番号を読むための
 *   ピンチまで奪う。本プロダクトが最優先で読ませたいのは実端子番号であり、
 *   小さな画面でそれを拡大できないのは致命的
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
