/**
 * ダイオードの定義（design.md §4.5・§5.4）。
 *
 * 実型番を持たない汎用部品。端子は「アノード / カソード」であって
 * 実端子番号ではないため `number` を持たせない。
 *
 * **MVP では常に開放（非導通）として扱う。** 単体ダイオードは一方向にしか
 * 導通せず、無向グラフである Union-Find では原理的に表現できないため
 * （design.md §5.4）。エンジン側の `conductingPairs()` は `kind: "diode"` に
 * 対して空配列を返す実装が Step 2 の時点で入っており、この定義を足しても
 * エンジンは 1 行も変わらない。
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
  visual: { width: 140, height: 110 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
