/**
 * 電源の定義（design.md §4.5・§4.13）。
 *
 * 実型番を持たない汎用部品。端子は "+24V" / "0V"、交流では "L" / "N" という
 * 呼称であり、実端子番号ではないため `number` を持たせない。
 *
 * **直流と交流で `ElectricalDefinition` の形は分けない。** どちらも
 * `kind: "power"` の `currentType` 違いで、エンジンは `currentType` を
 * 一度も読まない（`src/circuit/engine/` に 1 度も出現しない）。判定は
 * 交流でも「**同じ 1 台の電源**の両端に届くか」のまま（design.md §5.3）。
 *
 * 分かれるのは**端子の呼称と役割だけ。** 交流に + と 0V は無いので、
 * `TerminalRole` は `power_line` / `power_neutral` を使う。ここを
 * `power_positive` で済ませると、画面が「電源 +」と書いた時点で
 * 直流と同じものだと読ませてしまう。
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
  visual: { width: 150, height: 130 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};

/**
 * AC100V 電源（design.md §4.13）。
 *
 * 制御は DC24V、負荷は AC100V という制御盤の実際の構成をそのまま描くために置く。
 *
 * **`positiveTerminal` / `zeroTerminal` に L / N を当てているのは、
 * `ElectricalDefinition` の形に合わせるためだけ。** 交流の L が「+ 側」
 * という意味ではなく、L が非接地側・N が接地側という区別を持つだけで、
 * 電位差の両端としては対等に扱われる（G7L のコイル端子を
 * `positiveTerminal` / `negativeTerminal` に割り当てているのと同じ・§4.8）。
 *
 * **交流としての扱いはしない。** 位相・実効値・極性の反転は再現せず、
 * 「L と N の両方に届いているか」だけを見る。L–N 直結が電源短絡になるのも、
 * 別の電源の N をまたいだ負荷が通電しないのも、直流と同じ規則から出る。
 */
export const ac100vPowerSupply: ComponentDefinition = {
  id: "power-ac100v",
  model: "AC100V 電源",
  category: "power",
  terminals: [
    {
      id: "L",
      label: "L",
      role: "power_line",
      description: "L / 非接地側（ライブ）",
      position: { x: 1, y: 0.3 },
      side: "right",
    },
    {
      id: "N",
      label: "N",
      role: "power_neutral",
      description: "N / 接地側（ニュートラル）",
      position: { x: 1, y: 0.7 },
      side: "right",
    },
  ],
  electrical: {
    kind: "power",
    voltage: 100,
    currentType: "AC",
    positiveTerminal: "L",
    zeroTerminal: "N",
  },
  visual: { width: 150, height: 130 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
