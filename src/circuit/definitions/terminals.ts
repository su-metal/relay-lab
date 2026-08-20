/**
 * 端子台の定義（design.md §4.5）。
 *
 * 実型番を持たない汎用部品。番号は端子台に振られた通し番号であり、
 * リレーのような「型番ごとに決まった実端子番号」ではないため
 * `number` を持たせない（design.md §4.5 の扱いに合わせる）。
 *
 * 一般的な中継端子台として、上下で向かい合う端子だけが内部導通する。
 * たとえば 20P は 1–11、2–12、…、10–20 がそれぞれ独立した 10 組で、
 * 異なる組どうしは導通しない。L と N を同じ端子台で中継しても短絡しない。
 *
 * 極数違いは実端子番号を持たない**同じ抽象部品**なので、`buildTerminalBlock`
 * 1 つを極数と寸法で呼び分けるだけで足りる（CLAUDE.md 設計原則 2）。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

/** 上下 2 段。上段と同じ列の下段端子が内部で 1 対 1 に導通する */
const buildTerminals = (poles: number): TerminalDefinition[] => {
  const perSide = poles / 2;
  return Array.from({ length: poles }, (_, index): TerminalDefinition => {
    const id = String(index + 1);
    const top = index < perSide;
    const column = top ? index : index - perSide;
    const pairedId = String(top ? index + perSide + 1 : index - perSide + 1);
    return {
      id,
      label: id,
      role: "generic",
      description: `端子 ${id} / 端子台（端子 ${pairedId} と内部導通）`,
      position: { x: (column + 1) / (perSide + 1), y: top ? 0 : 1 },
      side: top ? "top" : "bottom",
    };
  });
};

/** 端子台 1 台ぶんの定義を組み立てる */
const buildTerminalBlock = (
  poles: number,
  visual: { width: number; height: number },
): ComponentDefinition => {
  const terminals = buildTerminals(poles);
  return {
    id: `terminal-block-${poles}p`,
    model: `汎用端子台 ${poles}P`,
    category: "terminal",
    terminals,
    electrical: {
      kind: "terminal",
      // 上段 → 下段の順。エンジンは同じ列どうしを 1 対 1 で中継する。
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

/** 上段 6・下段 6 */
export const genericTerminalBlock12P: ComponentDefinition = buildTerminalBlock(12, {
  width: 350,
  height: 170,
});

/** 上段 10・下段 10。1–11、2–12、…、10–20 が内部導通 */
export const genericTerminalBlock20P: ComponentDefinition = buildTerminalBlock(20, {
  width: 550,
  height: 170,
});
