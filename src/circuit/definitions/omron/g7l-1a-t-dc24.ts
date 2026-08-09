/**
 * OMRON G7L-1A-T DC24V — 1 極 a接点、タブ端子・E金具取付形。design.md §4.8。
 *
 * 端子表とコイル以外はすべて `g7l-series.ts` が受け持つ。
 * ねじ端子形（-B）・基板端子形（-P）・テストボタン付（-J）・
 * 上部ブラケット取付形（-UB）は今回のスコープ外（型番分岐はどこにも書かない）。
 */

import { G7L_1A_CONTACT_ROWS, defineG7lRelay } from "./g7l-series";

export const omronG7l1aTDc24 = defineG7lRelay({
  id: "omron-g7l-1a-t-dc24",
  model: "G7L-1A-T",
  contactRows: G7L_1A_CONTACT_ROWS,
  visual: { width: 180, height: 160 },
});
