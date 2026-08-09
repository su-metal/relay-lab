/**
 * スイッチの定義（design.md §4.5 / §4.7）。
 *
 * 実型番を持たない汎用部品。端子ラベルは "1" / "2" とする。
 * IEC 慣例の 13-14（a 接点）/ 11-12（b 接点）は採らない —
 * MY4N のコイル 13 / 14 と紛らわしく、初学者が実端子番号と取り違えるため。
 *
 * 種別は **接点（NO / NC）× 動作（モーメンタリ / オルタネート）** の 2 軸で、
 * 端子構成はどれも同じ。表を 4 回書き写すと 1 箇所直し忘れた瞬間に
 * 端子の呼称がずれるので、`defineSwitch()` に寄せて 1 箇所に置く
 * （MY シリーズを `defineMyRelay()` に寄せたのと同じ理由・design.md §4.3.1）。
 */

import type { ComponentDefinition } from "@/circuit/types";

import { GENERIC_TERMINAL_SOURCE } from "./source-notes";

/**
 * スイッチ共通の見た目サイズ。
 * 型番表示（"押しボタン A接点（モーメンタリ）"）が 2 行で収まる幅を確保する。
 */
const SWITCH_VISUAL = { width: 160, height: 170 };

type SwitchSpec = {
  id: string;
  model: string;
  contactType: "NO" | "NC";
  action: "momentary" | "maintained";
  /** 端子 1（COM 側）の説明 */
  commonDescription: string;
  /** 端子 2（接点側）の説明。開閉のタイミングをここで言い切る */
  contactDescription: string;
};

/**
 * 端子構成・出典・サイズを固定し、差分（接点種別・動作・説明文）だけを受け取る。
 * エンジンは `contactType` と `action` しか見ないので、定義が増えても分岐は増えない。
 */
const defineSwitch = ({
  id,
  model,
  contactType,
  action,
  commonDescription,
  contactDescription,
}: SwitchSpec): ComponentDefinition => ({
  id,
  model,
  category: "switch",
  terminals: [
    {
      id: "1",
      label: "1",
      role: "common",
      description: commonDescription,
      position: { x: 0, y: 0.5 },
      side: "left",
    },
    {
      id: "2",
      label: "2",
      role: contactType === "NO" ? "normally_open" : "normally_closed",
      description: contactDescription,
      position: { x: 1, y: 0.5 },
      side: "right",
    },
  ],
  electrical: {
    kind: "switch",
    contactType,
    action,
    terminalA: "1",
    terminalB: "2",
  },
  visual: SWITCH_VISUAL,
  source: GENERIC_TERMINAL_SOURCE,
  verified: false,
});

/**
 * モーメンタリ押しボタン A 接点（NO）。
 *
 * 通常は開いており、押している間だけ 1–2 が導通する。
 */
export const pushbuttonNo = defineSwitch({
  id: "switch-pushbutton-no",
  model: "押しボタン A接点（モーメンタリ）",
  contactType: "NO",
  action: "momentary",
  commonDescription: "端子 1 / a接点 COM 側",
  contactDescription: "端子 2 / a接点（押している間だけ導通）",
});

/**
 * モーメンタリ押しボタン B 接点（NC）。
 *
 * 通常は 1–2 が導通しており、押している間だけ開く。停止ボタンに使う。
 */
export const pushbuttonNc = defineSwitch({
  id: "switch-pushbutton-nc",
  model: "押しボタン B接点（モーメンタリ）",
  contactType: "NC",
  action: "momentary",
  commonDescription: "端子 1 / b接点 COM 側",
  contactDescription: "端子 2 / b接点（押している間だけ開く）",
});

/**
 * オルタネート切替スイッチ A 接点（NO）。
 *
 * 1 回操作すると ON 位置に留まり、もう 1 回で OFF に戻る。
 * 押しボタンと違い**手を離しても状態が残る**ので、自己保持回路を組まなくても
 * リレーを励磁したままにできる（design.md §4.7）。
 */
export const selectorSwitchNo = defineSwitch({
  id: "switch-selector-no",
  model: "切替スイッチ A接点（オルタネート）",
  contactType: "NO",
  action: "maintained",
  commonDescription: "端子 1 / a接点 COM 側",
  contactDescription: "端子 2 / a接点（ON 位置の間ずっと導通）",
});

/**
 * オルタネート切替スイッチ B 接点（NC）。
 *
 * 通常は 1–2 が導通しており、ON 位置にすると開いたまま留まる。
 * 非常停止のように「操作したら戻さない限り切れたまま」を表現する。
 */
export const selectorSwitchNc = defineSwitch({
  id: "switch-selector-nc",
  model: "切替スイッチ B接点（オルタネート）",
  contactType: "NC",
  action: "maintained",
  commonDescription: "端子 1 / b接点 COM 側",
  contactDescription: "端子 2 / b接点（ON 位置の間ずっと開く）",
});
