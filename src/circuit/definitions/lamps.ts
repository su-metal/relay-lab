/**
 * 表示ランプの定義（design.md §4.5）。
 *
 * 実型番を持たない汎用部品。
 * ランプは負荷なので、エンジンは 2 端子を union しない（design.md §5.2）。
 * 「両端が異なる電源ネットに属するか」で点灯を判定する対象である。
 */

import type { ComponentDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

export const dc24vLamp: ComponentDefinition = {
  id: "lamp-dc24v",
  model: "DC24V 表示ランプ",
  category: "lamp",
  terminals: [
    {
      id: "1",
      label: "1",
      role: "generic",
      description: "端子 1 / ランプ（極性なし）",
      position: { x: 0, y: 0.5 },
      side: "left",
    },
    {
      id: "2",
      label: "2",
      role: "generic",
      description: "端子 2 / ランプ（極性なし）",
      position: { x: 1, y: 0.5 },
      side: "right",
    },
  ],
  electrical: {
    kind: "lamp",
    voltage: 24,
    currentType: "DC",
    terminalA: "1",
    terminalB: "2",
  },
  visual: { width: 140, height: 160 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
