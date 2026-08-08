/**
 * 端子台の定義（design.md §4.5）。
 *
 * 実型番を持たない汎用部品。番号は端子台に振られた通し番号であり、
 * リレーのような「型番ごとに決まった実端子番号」ではないため
 * `number` を持たせない（design.md §4.5 の扱いに合わせる）。
 *
 * 短絡バーで全極を渡らせた状態を模し、**列挙した全端子が常時導通する**。
 * +24V や 0V を複数系統へ分岐させるのに使う。導通は電線と同じ扱いなので、
 * エンジンはこれを union する（負荷ではない — design.md §5.1）。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

/** 上段 3 極 / 下段 3 極。上下に分けて 1 本の線を左右どちらへも渡せるようにする */
const TERMINAL_COUNT = 6;
const PER_SIDE = TERMINAL_COUNT / 2;

const terminals: TerminalDefinition[] = Array.from(
  { length: TERMINAL_COUNT },
  (_, index): TerminalDefinition => {
    const id = String(index + 1);
    const top = index < PER_SIDE;
    const column = top ? index : index - PER_SIDE;
    return {
      id,
      label: id,
      role: "generic",
      description: `端子 ${id} / 端子台（全端子が常時導通）`,
      position: { x: (column + 1) / (PER_SIDE + 1), y: top ? 0 : 1 },
      side: top ? "top" : "bottom",
    };
  },
);

export const genericTerminalBlock: ComponentDefinition = {
  id: "terminal-block-6p",
  model: "汎用端子台 6P（全極短絡）",
  category: "terminal",
  terminals,
  electrical: {
    kind: "terminal",
    terminals: terminals.map((terminal) => terminal.id),
  },
  visual: { width: 200, height: 170 },
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
