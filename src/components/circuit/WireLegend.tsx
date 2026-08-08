"use client";

/**
 * 停止中の配線色の凡例（design.md §5.8）。
 *
 * 赤＝+ 側・青＝0V は実務の盤配線と同じなので説明が要らないが、
 * **「灰の破線＝どこにも電源が届いていない」だけは読み取れない。**
 * 凡例が無いと、この色分けは「なんとなく色が付いている」で終わる。
 *
 * 実行中は色の意味が状態色（§5.6）へ切り替わるので、この凡例は出さない。
 */

import type { WireRole } from "@/circuit/adapter/wire-role";

import styles from "./WireLegend.module.css";

/** 凡例に出す役割と文言。`isolated` を最後に置いて「気付き」の位置にする */
const LEGEND: readonly { role: WireRole; label: string; hint: string }[] = [
  { role: "plus", label: "+ 側", hint: "電源の + に直結している線" },
  { role: "zero", label: "0V", hint: "電源の 0V に直結している線" },
  {
    role: "control",
    label: "制御線",
    hint: "接点・スイッチが閉じれば電源につながる線",
  },
  {
    role: "isolated",
    label: "未接続",
    hint: "どう動作させても電源に届かない線（配線漏れの可能性）",
  },
];

/** 役割 → 見本線のクラス。短絡は凡例に出さない（診断パネルが警告として出す） */
const SWATCH_CLASS: Partial<Record<WireRole, string>> = {
  plus: styles.plus,
  zero: styles.zero,
  control: styles.control,
  isolated: styles.isolated,
};

export function WireLegend() {
  return (
    <ul className={styles.legend}>
      {LEGEND.map(({ role, label, hint }) => (
        <li key={role} className={styles.item} title={hint}>
          <span className={`${styles.swatch} ${SWATCH_CLASS[role]}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}
