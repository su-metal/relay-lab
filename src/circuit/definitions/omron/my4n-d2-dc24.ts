/**
 * OMRON MY4N-D2 DC24V — 14 ピン。design.md §4.3。
 *
 * 端子配置は MY4N と完全に同一で、違いは**コイルに逆起電力吸収ダイオードを
 * 内蔵している**点だけ。極性を逆にすると内蔵ダイオードが順方向になるため
 * 励磁せず、電源短絡状態になる → `polarity: "strict"`。
 *
 * **MY4N との差がこの 1 値だけで表現できていることが、
 * データ駆動設計が機能している証拠**（requirements.md US-F）。
 * エンジンは `CoilPolarity` の 3 値しか見ておらず、型番を知らない。
 */

import { MY4N_CONTACT_ROWS, defineMyRelay } from "./my-series";

export const omronMy4nD2Dc24 = defineMyRelay({
  id: "omron-my4n-d2-dc24",
  model: "MY4N-D2",
  contactRows: MY4N_CONTACT_ROWS,
  polarity: "strict",
  coilNote: "ダイオード内蔵・極性厳守",
  visual: { width: 260, height: 240 },
});
