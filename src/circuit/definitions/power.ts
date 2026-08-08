/**
 * 電源の定義（design.md §4.5）。
 *
 * 実型番を持たない汎用部品。端子は "+24V" / "0V" という呼称であり、
 * 実端子番号ではないため `number` を持たせない。
 */

import type { ComponentDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

export const dc24vPowerSupply: ComponentDefinition = {
  id: "power-dc24v",
  model: "DC24V 電源",
  category: "power",
  terminals: [
    {
      id: "plus",
      label: "+24V",
      role: "power_positive",
      description: "+24V / 電源プラス側",
      position: { x: 1, y: 0.3 },
      side: "right",
    },
    {
      id: "zero",
      label: "0V",
      role: "power_zero",
      description: "0V / 電源マイナス（コモン）側",
      position: { x: 1, y: 0.7 },
      side: "right",
    },
  ],
  electrical: {
    kind: "power",
    voltage: 24,
    currentType: "DC",
    positiveTerminal: "plus",
    zeroTerminal: "zero",
  },
  // 右辺の端子ラベル（"+24V" / "0V"）と本体表示がぶつからない幅
  visual: { width: 150, height: 110 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
