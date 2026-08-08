/**
 * OMRON MY2N DC24V — 8 ピン（ソケット PYF08A 系）。design.md §4.2。
 *
 * MY4N の 1 回路目（1-5-9）と 4 回路目（4-8-12）だけを持つため、
 * 端子番号は 1・4・5・8・9・12・13・14 の **飛び番**になる。
 * 1〜8 に詰め直さないことが本プロダクトの価値の中核（requirements.md US-F）。
 */

import { MY2N_CONTACT_ROWS, defineMyRelay } from "./my-series";

export const omronMy2nDc24 = defineMyRelay({
  id: "omron-my2n-dc24",
  model: "MY2N",
  contactRows: MY2N_CONTACT_ROWS,
  // MY4N と同じく表示 LED 付き。逆接でも励磁するが表示灯が点かない（design.md §4.4）
  polarity: "indicator",
  // 接点が 2 回路なので MY4N より小さくてよいが、
  // 上下に並ぶ端子番号が窮屈にならない幅は確保する
  visual: { width: 210, height: 220 },
});
