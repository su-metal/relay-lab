/**
 * ダイオードの定義（design.md §4.5・§5.4）。
 *
 * 実型番を持たない汎用部品。端子は「アノード / カソード」であって
 * 実端子番号ではないため `number` を持たせない。
 *
 * **端子は union しない。** 一方通行は無向グラフの Union-Find では表せないため、
 * 導通は `engine/diode.ts` の有向な電位伝搬（アノード → カソード）で表現する
 * （design.md §5.4）。この定義に書くのは向きの出どころ（どちらがアノードか）だけで、
 * 「逆起電力を吸収する」「逆向きなら短絡する」という挙動はすべてそこから導かれる。
 */

import type { ComponentDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

export const genericDiode: ComponentDefinition = {
  id: "diode-generic",
  model: "汎用ダイオード",
  category: "diode",
  terminals: [
    {
      id: "a",
      label: "A",
      role: "anode",
      description: "A / アノード（電流の入る側）",
      position: { x: 0, y: 0.5 },
      side: "left",
    },
    {
      id: "k",
      label: "K",
      role: "cathode",
      description: "K / カソード（帯のある側）",
      position: { x: 1, y: 0.5 },
      side: "right",
    },
  ],
  electrical: {
    kind: "diode",
    anodeTerminal: "a",
    cathodeTerminal: "k",
  },
  visual: { width: 140, height: 190 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
