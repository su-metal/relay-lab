/**
 * OMRON G7L-2A-B DC24V — 2 極・a 接点・ねじ端子形。design.md §4.8。
 *
 * 端子は **0・1・2・4・6・8** の 6 本。接点は第 1 極が 2–4、第 2 極が 6–8 で、
 * 奇数番号は存在しない（コイルの 1 を除く）。
 *
 * **1 極形との差は接点行だけ。** コイルも極性も定格も同じで、
 * `defineG7lRelay()` に渡す表が 1 行か 2 行かしか違わない
 * （design.md §4.8 の確度表）。
 */

import { G7L_2A_CONTACT_ROWS, defineG7lRelay } from "./g7l-series";

export const omronG7l2aBDc24 = defineG7lRelay({
  id: "omron-g7l-2a-b-dc24",
  model: "G7L-2A-B",
  contactRows: G7L_2A_CONTACT_ROWS,
  // 接点 2 極ぶんの端子が上下に 2 本ずつ並ぶので、1 極形より広く取る
  visual: { width: 240, height: 200 },
});
