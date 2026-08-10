"use client";

/**
 * 配線色の凡例（design.md §5.8・§5.9）。
 *
 * 色の意味は停止中（役割・§5.8）と実行中（状態・§5.6）で切り替わるので、
 * 凡例も 2 種類持つ。どちらも「見れば分かる色」は説明が要らないが、
 * **読み取れない色が 1 つずつある。**
 *
 * - 停止中: 灰の破線＝どこにも電源が届いていない
 * - 実行中: 紫の流れる破線＝自己保持（この線を切ればリレーが落ちる）
 * - 実行中: 線を流れる切れ目＝電流の向き（design.md §5.10）。これは色の軸では
 *   なく**動きの軸**なので、緑にも紫にも同じように乗る
 *
 * 凡例が無いと、その 1 色が「なんとなく色が付いている」で終わる。
 *
 * **見本線は実際の描かれ方を写す。** 実行中の待機線（赤・青・灰）は
 * キャンバス上で濃さを落としてあるので、凡例の見本も同じだけ薄くする。
 * 「薄い＝電流が流れていない」という軸そのものが読み取らせたい情報であり、
 * 見本だけ濃く描くとその軸が凡例から抜け落ちる。
 */

import styles from "./WireLegend.module.css";

type LegendItem = {
  /** 見本線のクラス（`WireLegend.module.css`） */
  swatch?: string;
  label: string;
  hint: string;
};

/** 停止中＝役割配色（§5.8）。`isolated` を最後に置いて「気付き」の位置にする */
const ROLE_LEGEND: readonly LegendItem[] = [
  { swatch: styles.plus, label: "+ 側", hint: "電源の + に直結している線" },
  { swatch: styles.zero, label: "0V", hint: "電源の 0V に直結している線" },
  {
    swatch: styles.control,
    label: "制御線",
    hint: "接点・スイッチが閉じれば電源につながる線",
  },
  {
    swatch: styles.isolated,
    label: "未接続",
    hint: "どう動作させても電源に届かない線（配線漏れの可能性）",
  },
];

/**
 * 実行中＝状態色（§5.6・§5.9）。
 *
 * **通電している 2 つを先に置く。** 実行中に最初に読ませたいのは
 * 「今どこに電流が流れているか」で、待機している線はその後でよい。
 */
const STATE_LEGEND: readonly LegendItem[] = [
  {
    swatch: styles.energized,
    label: "通電中",
    hint: "励磁したコイル・点灯したランプに電流が流れている線",
  },
  {
    swatch: styles.selfHold,
    label: "自己保持",
    hint: "リレーが自分の接点で自分を保持している線。ここを切ると落ちます",
  },
  {
    // 色ではなく**動き**の見本（design.md §5.10）。緑にも紫にも同じように乗る
    swatch: styles.flow,
    label: "電流の向き",
    hint: "線の切れ目が流れていく向きが電流の向きです。並列に分かれた区間は分流するので向きが出ません",
  },
  {
    swatch: `${styles.plus} ${styles.idle}`,
    label: "+ 側",
    hint: "+ 側だけに届いている線。電圧は来ていますが電流は流れていません",
  },
  {
    swatch: `${styles.zero} ${styles.idle}`,
    label: "0V",
    hint: "0V 側だけに届いている線。電圧は来ていますが電流は流れていません",
  },
  {
    // 実行中も停止中と同じ濃さで描く（キャンバス側も打ち消してある）。
    // 非通電の中で唯一「直すべき線」なので、ここだけは薄くしない
    swatch: styles.isolated,
    label: "未接続",
    hint: "どう動作させても電源に届かない線（配線漏れの可能性）",
  },
];

export type WireLegendProps = {
  /** シミュレーション実行中か。色の意味が §5.8 から §5.6・§5.9 へ切り替わる */
  running: boolean;
};

export function WireLegend({ running }: WireLegendProps) {
  return (
    <ul className={styles.legend}>
      {(running ? STATE_LEGEND : ROLE_LEGEND).map(({ swatch, label, hint }) => (
        <li key={label} className={styles.item} title={hint}>
          <span className={`${styles.swatch} ${swatch ?? ""}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}
