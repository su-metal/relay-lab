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
 *
 * 極数違いは実端子番号を持たない**同じ抽象部品**なので、`buildTerminalBlock`
 * 1 つを極数と寸法で呼び分けるだけで足りる（CLAUDE.md 設計原則 2 —— 新型番の
 * 追加が定義ファイル 1 枚で完結すること。実際にはここでは 1 関数の呼び出しで済む）。
 * `TerminalBlockBody` は極数を `terminals.length` から読むので、こちら側も
 * 一切変更していない。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

/** 上下 2 段に分け、1 本の線を左右どちらへも渡せるようにする */
const buildTerminals = (poles: number): TerminalDefinition[] => {
  const perSide = poles / 2;
  return Array.from({ length: poles }, (_, index): TerminalDefinition => {
    const id = String(index + 1);
    const top = index < perSide;
    const column = top ? index : index - perSide;
    return {
      id,
      label: id,
      role: "generic",
      description: `端子 ${id} / 端子台（全端子が常時導通）`,
      position: { x: (column + 1) / (perSide + 1), y: top ? 0 : 1 },
      side: top ? "top" : "bottom",
    };
  });
};

/**
 * 端子台 1 台ぶんの定義を組み立てる。
 *
 * 極数が増えるほど 1 段あたりの端子も増えるので、`visual.width` も呼び出し側で
 * 極数に応じて広げる —— 詰めたままだと端子の丸（12px）どうしが重なる。
 */
const buildTerminalBlock = (
  poles: number,
  visual: { width: number; height: number },
): ComponentDefinition => {
  const terminals = buildTerminals(poles);
  return {
    id: `terminal-block-${poles}p`,
    model: `汎用端子台 ${poles}P（全極短絡）`,
    category: "terminal",
    terminals,
    electrical: {
      kind: "terminal",
      terminals: terminals.map((terminal) => terminal.id),
    },
    visual,
    source: GENERIC_TERMINAL_SOURCE,
    verified: false,
  };
};

export const genericTerminalBlock: ComponentDefinition = buildTerminalBlock(6, {
  width: 200,
  height: 170,
});

/** 上段 6・下段 6。端子の丸の間隔を 6P と揃えるため幅を比例で広げる */
export const genericTerminalBlock12P: ComponentDefinition = buildTerminalBlock(12, {
  width: 350,
  height: 170,
});

/** 上段 10・下段 10 */
export const genericTerminalBlock20P: ComponentDefinition = buildTerminalBlock(20, {
  width: 550,
  height: 170,
});

