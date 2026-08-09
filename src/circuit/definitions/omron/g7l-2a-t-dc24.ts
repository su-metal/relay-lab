/**
 * OMRON G7L-2A-T DC24V — 2 極 a接点、タブ端子・E金具取付形。design.md §4.8。
 *
 * G7L-1A-T との差は「使う接点行が 2 行」だけ。端子番号・コイルはすべて
 * `g7l-series.ts` の共通ロジックが受け持つ（CLAUDE.md 設計原則 2）。
 */

import { G7L_2A_CONTACT_ROWS, defineG7lRelay } from "./g7l-series";

export const omronG7l2aTDc24 = defineG7lRelay({
  id: "omron-g7l-2a-t-dc24",
  model: "G7L-2A-T",
  contactRows: G7L_2A_CONTACT_ROWS,
  visual: { width: 220, height: 180 },
});
