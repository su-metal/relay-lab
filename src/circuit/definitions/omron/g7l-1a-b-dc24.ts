/**
 * OMRON G7L-1A-B DC24V — 1 極・a 接点・ねじ端子形。design.md §4.8。
 *
 * 端子は **0・1・4・6** の 4 本。2 極形（`g7l-2a-b-dc24.ts`）の 2 と 8 が
 * 欠番になった飛び番で、MY2N が 1・4・5・8・9・12 を飛び番のまま持つのと
 * 同じ性質のデータ。**4–6 を 2–4 に詰め直してはならない**
 * （requirements.md US-F・design.md §4.8）。
 *
 * b 接点は実機に無い。非励磁では 4–6 がどこにも繋がらない（design.md §5.1）。
 */

import { G7L_1A_CONTACT_ROWS, defineG7lRelay } from "./g7l-series";

export const omronG7l1aBDc24 = defineG7lRelay({
  id: "omron-g7l-1a-b-dc24",
  model: "G7L-1A-B",
  contactRows: G7L_1A_CONTACT_ROWS,
  // 接点が 1 極なので 2 極形より狭くてよいが、
  // "OMRON G7L-1A-B" の見出しが収まる幅は確保する
  visual: { width: 200, height: 200 },
});
