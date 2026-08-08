/**
 * OMRON MY4N DC24V — 14 ピン（ソケット PYF14A 系）。design.md §4.1。
 *
 * 端子表とコイルの極性以外はすべて `my-series.ts` が受け持つ。
 * MY2N / MY4N-D2 との差は「使う接点行」と「極性」だけで、
 * 型番分岐はどこにも書かない（CLAUDE.md 設計原則 2）。
 */

import { MY4N_CONTACT_ROWS, defineMyRelay } from "./my-series";

export const omronMy4nDc24 = defineMyRelay({
  id: "omron-my4n-dc24",
  model: "MY4N",
  contactRows: MY4N_CONTACT_ROWS,
  // 「N」は表示 LED 付きの意。コイル自体は無極性で逆接でも励磁するが、
  // 表示 LED が点灯しない、という理解（design.md §4.4「要検証」）。
  // 内蔵ダイオード付きの MY4N-D2 は "strict"。
  polarity: "indicator",
  visual: { width: 260, height: 220 },
});
