"use client";

/**
 * 配線色の凡例（design.md §5.8・§5.9）。
 *
 * 色の意味は停止中（役割・§5.8）・経路確認中（到達範囲・§5.15）・実行中
 * （状態・§5.6）で切り替わるので、凡例も 3 種類持つ。どちらも「見れば分かる色」は説明が要らないが、
 * **読み取れない色が 1 つずつある。**
 *
 * - 停止中: 灰の破線＝どこにも電源が届いていない
 * - 経路確認中: 破線＝実際に電位が届いている線（実行中の実線と読み分ける）
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
    // 色ではなく**動き**の見本（design.md §5.10）
    swatch: styles.flow,
    label: "電流の向き",
    hint: "切れ目（自己保持の紫は破線そのもの）が流れていく向きが電流の向きです。並列に分かれた区間は分流するので向きが出ません",
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

/**
 * 経路確認モード（design.md §8.14）。
 *
 * **読ませたい順に置く。** このモードで最初に知りたいのは
 * 「どこまで来ているか」ではなく「**どこで止まっているか**」——
 * 到達範囲は色で一目で分かるが、止まっている箇所は説明が無いと
 * ただの黄色い点線に見える。
 */
const PREVIEW_LEGEND: readonly LegendItem[] = [
  {
    swatch: styles.predictedEnergized,
    label: "励磁する",
    hint: "この状態のままでコイルが励磁する・ランプが点灯する経路",
  },
  {
    swatch: `${styles.plus} ${styles.predicted}`,
    label: "+ 側が到達",
    hint: "電源の + 側の電位がここまで来ています",
  },
  {
    swatch: `${styles.zero} ${styles.predicted}`,
    label: "0V が到達",
    hint: "電源の 0V 側がここまで来ています",
  },
  {
    swatch: `${styles.idle}`,
    label: "まだ届かない",
    hint: "今は電位が届いていない線。接点やスイッチが閉じれば届くこともあります",
  },
  {
    // 色ではなく**部品に付く目印**の説明。線の見本を持たない唯一の項目
    label: "⌁ 止まっている部品",
    hint: "黄色い点線で囲まれた部品で電位が止まっています。右の一覧に端子番号が出ます",
  },
];

/**
 * 調光信号線（design.md §5.17）。**3 通りすべてに同じものを足す。**
 *
 * この色だけは停止中も実行中も経路確認中も同じ意味（0–10V の信号線）で、
 * 導通の色の軸とは独立している —— だから色の意味が切り替わっても
 * この 1 行は切り替わらない。
 *
 * **回路に調光が 1 本も無ければ出さない。** 凡例は「読み取れない色を
 * 説明する」ためのもので、画面に出ていない色を並べるとその役目が薄まる。
 */
const ANALOG_LEGEND_ITEM: LegendItem = {
  swatch: styles.analog,
  label: "調光信号",
  hint: "0–10V の調光信号線。線に添えた数字が電圧です（この設定では 0V＝100%・10V＝0%）。電源の導通とは別の量なので、届いていない線とは別の色で描いています",
};

export type WireLegendProps = {
  /** シミュレーション実行中か。色の意味が §5.8 から §5.6・§5.9 へ切り替わる */
  running: boolean;
  /**
   * 経路確認モードか（design.md §8.14）。`running` とは排他
   * （`simulationStore` が守っている）。
   */
  pathPreview?: boolean;
  /**
   * 畳んで出すか（design.md §8.12）。狭い画面では 6 項目を広げると図面を覆う。
   * **「凡例がある」ことは畳んでも見せ続ける** —— 隠してしまうと、読めない
   * 1 色（紫の自己保持・灰の破線）に説明が付いていること自体に気付けない。
   */
  collapsible?: boolean;
  /**
   * 調光信号線が 1 本でもあるか（design.md §5.17）。
   * 無ければ調光の項目を出さない —— 画面に出ていない色は説明しない。
   */
  analog?: boolean;
};

export function WireLegend({
  running,
  pathPreview,
  collapsible,
  analog,
}: WireLegendProps) {
  // 3 通りのうち 1 つだけが載る。実行中が最優先だが、そもそも排他なので
  // ここで順位が問題になることは無い
  const base = running
    ? STATE_LEGEND
    : pathPreview
      ? PREVIEW_LEGEND
      : ROLE_LEGEND;
  const legend = analog ? [...base, ANALOG_LEGEND_ITEM] : base;

  const items = (
    <ul className={styles.legend} data-inline={collapsible || undefined}>
      {legend.map(({ swatch, label, hint }) => (
        <li key={label} className={styles.item} title={hint}>
          {/* 線の見本を持たない項目がある（部品に付く目印の説明） */}
          {swatch && <span className={`${styles.swatch} ${swatch}`} />}
          {label}
        </li>
      ))}
    </ul>
  );

  if (!collapsible) return items;

  // 開閉の状態は `<details>` に持たせる。React の状態にすると、
  // 実行・停止で色の意味が入れ替わるたびに開閉まで作り直すことになる
  return (
    <details className={styles.disclosure}>
      <summary className={styles.summary}>凡例</summary>
      {items}
    </details>
  );
}
