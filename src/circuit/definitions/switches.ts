/**
 * 押しボタンの定義（design.md §4.5）。
 *
 * 実型番を持たない汎用部品。端子ラベルは "1" / "2" とする。
 * IEC 慣例の 13-14（a 接点）/ 11-12（b 接点）は採らない —
 * MY4N のコイル 13 / 14 と紛らわしく、初学者が実端子番号と取り違えるため。
 */

import type { ComponentDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

/**
 * 押しボタン共通の見た目サイズ。
 * 型番表示（"押しボタン A接点（モーメンタリ）"）が 2 行で収まる幅を確保する。
 */
const PUSHBUTTON_VISUAL = { width: 160, height: 125 };

/**
 * モーメンタリ押しボタン A 接点（NO）。
 *
 * 通常は開いており、押している間だけ 1–2 が導通する。
 */
export const pushbuttonNo: ComponentDefinition = {
  id: "switch-pushbutton-no",
  model: "押しボタン A接点（モーメンタリ）",
  category: "switch",
  terminals: [
    {
      id: "1",
      label: "1",
      role: "common",
      description: "端子 1 / a接点 COM 側",
      position: { x: 0, y: 0.5 },
      side: "left",
    },
    {
      id: "2",
      label: "2",
      role: "normally_open",
      description: "端子 2 / a接点（押している間だけ導通）",
      position: { x: 1, y: 0.5 },
      side: "right",
    },
  ],
  electrical: {
    kind: "switch",
    contactType: "NO",
    action: "momentary",
    terminalA: "1",
    terminalB: "2",
  },
  visual: PUSHBUTTON_VISUAL,
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};

/**
 * モーメンタリ押しボタン B 接点（NC）。
 *
 * 通常は 1–2 が導通しており、押している間だけ開く。停止ボタンに使う。
 */
export const pushbuttonNc: ComponentDefinition = {
  id: "switch-pushbutton-nc",
  model: "押しボタン B接点（モーメンタリ）",
  category: "switch",
  terminals: [
    {
      id: "1",
      label: "1",
      role: "common",
      description: "端子 1 / b接点 COM 側",
      position: { x: 0, y: 0.5 },
      side: "left",
    },
    {
      id: "2",
      label: "2",
      role: "normally_closed",
      description: "端子 2 / b接点（押している間だけ開く）",
      position: { x: 1, y: 0.5 },
      side: "right",
    },
  ],
  electrical: {
    kind: "switch",
    contactType: "NC",
    action: "momentary",
    terminalA: "1",
    terminalB: "2",
  },
  visual: PUSHBUTTON_VISUAL,
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
};
