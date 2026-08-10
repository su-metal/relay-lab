/**
 * OMRON G7L シリーズ共通の端子生成（design.md §4.8）。
 *
 * MY シリーズ（`my-series.ts`）とは端子番号の振り方が別系列なので、
 * **表を共有しない**（design.md §4.3.1 の但し書き）。G7L は 14 ピンの
 * 差込みソケットではなく、ねじ端子に 0 始まりの番号が振られる。
 *
 * **ここに型番分岐は書かない。** 1 極と 2 極の差は呼び出し側が渡す
 * 接点行だけで表現する（CLAUDE.md 設計原則 2）。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";
import type { RelayContact } from "@/circuit/types";

/**
 * G7L の**公式**カタログ。端子データの出典（design.md §4.8）。
 *
 * オムロン制御機器「G7L パワーリレー」カタログ番号 CDPA-041C（2025 年 4 月現在）。
 * p.1 に形式基準、p.3 に操作コイルの定格、**p.8 に端子配置/内部接続図
 * （TOP VIEW）**、p.12 にコイル内部接続図がある。
 */
export const G7L_SERIES_SOURCE =
  "OMRON G7L パワーリレー カタログ CDPA-041C（p.8 端子配置/内部接続図 TOP VIEW） https://www.fa.omron.co.jp/products/family/2837/download/catalog.html";

/**
 * a 接点 1 極ぶんの実端子番号。
 *
 * **COM は無い。** G7L の接点はダブルブレークの a 接点で、2 端子は対等。
 * どちらが入力でどちらが出力という決まりはカタログのどこにも書かれていない。
 */
export type G7lContactRow = {
  /** 若い方の端子番号 */
  low: string;
  /** 大きい方の端子番号 */
  high: string;
};

/**
 * G7L-2A（2 極）の接点表そのまま（design.md §4.8）。
 * 第 1 極が 2–4、第 2 極が 6–8。
 */
export const G7L_2A_CONTACT_ROWS: readonly G7lContactRow[] = [
  { low: "2", high: "4" },
  { low: "6", high: "8" },
];

/**
 * G7L-1A（1 極）の接点表（design.md §4.8）。
 *
 * **2 極の 1 行目（2–4）ではなく 4–6 を使う。** カタログ p.8 の 1 極の図では
 * 接点端子が **4 と 6**（2 極でいう内側 2 本の位置）に振られており、
 * 2 と 8 が欠番になる。MY2N の飛び番と同じで、ここを 2–4 に詰め直すと
 * 実機と違う番号を教えることになる（requirements.md US-F）。
 */
export const G7L_1A_CONTACT_ROWS: readonly G7lContactRow[] = [
  { low: "4", high: "6" },
];

/**
 * コイルは全型番共通で 0 と 1。
 *
 * **どちらが + でも − でもない。** カタログ p.8 の各図に
 * 「（コイル極性はありません）」と明記され、p.12 のコイル内部接続図でも
 * 直流操作コイルは 0–1 間が素のコイル記号だけ（ダイオードも LED も無い）。
 * `positiveTerminal` / `negativeTerminal` は `RelayDefinition` の形に
 * 合わせるための割り当てにすぎず、`polarity: "none"` なので
 * どちら向きに繋いでも励磁する（design.md §5.3）。
 */
const COIL_A = "0";
const COIL_B = "1";

/**
 * 接点端子の画面配置。実機のねじ端子の並び（コイルが上辺・接点が下辺）は模さず、
 * MY シリーズと同じ「コイルは左辺」で揃える（design.md §8）。
 *
 * パレットにリレーが並んだとき、型番ごとにコイルの位置が変わると
 * 制御回路をどちら側に描くかが型番次第になってしまう。
 * 接点は 1 極ぶんを上下 1 組にし、位置は端子番号ではなく
 * **何極中の何番目か**から決める（MY シリーズの `spread()` と同じ考え方）。
 */
const spread = (index: number, count: number) => (index + 1) / (count + 1);

type G7lRelayOptions = {
  id: string;
  model: string;
  contactRows: readonly G7lContactRow[];
  visual: { width: number; height: number };
};

/**
 * 接点行から `RelayContact[]` を組む。
 *
 * 対等な 2 端子を `commonTerminal` / `noTerminal` に割り当てているのは、
 * `RelayContact` が c 接点を基準にした形をしているため。**若い番号を
 * `commonTerminal` に置くのは並びを決めるためだけの規約**で、
 * 実機に COM があるという意味ではない（端子の `role` は両方とも
 * `normally_open` にしてある）。エンジンはこの 2 端子を励磁中だけ
 * union するので、どちらに置いても挙動は変わらない。
 */
const buildContacts = (rows: readonly G7lContactRow[]): RelayContact[] =>
  rows.map((row, index) => ({
    id: `c${index + 1}`,
    commonTerminal: row.low,
    noTerminal: row.high,
    // NC 端子は実機に存在しない。持たせないことで非励磁時にどこにも
    // 閉じなくなる（design.md §5.1）
    type: "SPST-NO",
  }));

const buildTerminals = (
  rows: readonly G7lContactRow[],
): TerminalDefinition[] => {
  const contactTerminals = rows.flatMap<TerminalDefinition>((row, index) => {
    const order = index + 1;
    const along = spread(index, rows.length);
    return [
      {
        id: row.low,
        label: row.low,
        number: row.low,
        role: "normally_open",
        contactGroup: `c${order}`,
        description: `端子 ${row.low} / 第${order}極 a接点`,
        position: { x: along, y: 0 },
        side: "top",
      },
      {
        id: row.high,
        label: row.high,
        number: row.high,
        role: "normally_open",
        contactGroup: `c${order}`,
        description: `端子 ${row.high} / 第${order}極 a接点`,
        position: { x: along, y: 1 },
        side: "bottom",
      },
    ];
  });

  const coilTerminals: TerminalDefinition[] = [
    {
      id: COIL_A,
      label: COIL_A,
      number: COIL_A,
      role: "coil",
      description: `端子 ${COIL_A} / コイル / DC24V（極性なし）`,
      position: { x: 0, y: 0.35 },
      side: "left",
    },
    {
      id: COIL_B,
      label: COIL_B,
      number: COIL_B,
      role: "coil",
      description: `端子 ${COIL_B} / コイル / DC24V（極性なし）`,
      position: { x: 0, y: 0.65 },
      side: "left",
    },
  ];

  // 端子番号の昇順に並べる。1 極の 0・1・4・6 のような飛び番でも
  // プロパティパネルの端子一覧が実機の番号順に読める
  return [...contactTerminals, ...coilTerminals].sort(
    (a, b) => Number(a.id) - Number(b.id),
  );
};

/**
 * G7L の DC24V リレー定義を組み立てる。
 *
 * 端子データは公式カタログ（`G7L_SERIES_SOURCE`）p.8 の端子配置/内部接続図
 * （TOP VIEW）と突き合わせ済みで **検証済み**（`verified: true`）。
 * 同じページに E 金具取りつけ形とアダプタ取りつけ形の 2 枚の図があり、
 * どちらも同じ番号を振っていることまで確認している（design.md §4.9）。
 *
 * **端子形状違い（-T / -P）や取りつけ違い（-UB）へ流用するときは番号を
 * 引き写さない。** ここで検証したのは**ねじ端子形（-B）の図**であって、
 * タブ端子形・プリント基板端子形は別の図が載っている
 * （CLAUDE.md 設計原則 5）。
 */
export const defineG7lRelay = ({
  id,
  model,
  contactRows,
  visual,
}: G7lRelayOptions): ComponentDefinition => ({
  id,
  manufacturer: "OMRON",
  model,
  category: "relay",
  terminals: buildTerminals(contactRows),
  electrical: {
    kind: "relay",
    relay: {
      coil: {
        voltage: 24,
        currentType: "DC",
        // 極性が無いので割り当ては形式的なもの。`polarity: "none"` が本体
        positiveTerminal: COIL_A,
        negativeTerminal: COIL_B,
        polarity: "none",
      },
      contacts: buildContacts(contactRows),
    },
  },
  visual,
  source: G7L_SERIES_SOURCE,
  verified: true,
});
