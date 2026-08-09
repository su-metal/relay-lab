/**
 * OMRON G7L シリーズ共通の端子生成（design.md §4.8）。
 *
 * G7L は MY シリーズと違い **a接点（SPST-NO）のみ**で、b接点・c接点の
 * バリエーションはカタログ全体を通じて存在しない（OMRON G7L 総合カタログ
 * CDPA-041C p.1「形式基準」の②接点構成が常に `A`）。1 極 / 2 極の差だけで
 * 接点自体のトポロジは MY シリーズの SPDT と異なる。
 *
 * **ここに型番分岐は書かない。** 型番ごとの差は呼び出し側が渡す引数
 * （接点行・コイル定格・サイズ）だけで表現する（`my-series.ts` と同じ方針）。
 */

import type { ComponentDefinition, TerminalDefinition } from "@/circuit/types";
import type { RelayContact } from "@/circuit/types";

/**
 * G7L の**公式**総合カタログ。端子データの出典（design.md §4.8）。
 * URL を張れる公開データシートではなくユーザー提供の PDF なので、
 * カタログ番号とページで出典を特定できるようにする。
 */
export const G7L_SERIES_SOURCE =
  "OMRON G7L パワーリレー 総合カタログ（資料番号 CDPA-041C、2025年4月現在）" +
  " ― 端子配置/内部接続図 p.5〜10、コイル記号（極性なし）p.12";

/** 1 接点ぶんの実端子番号。a接点のみなので NC は存在しない */
export type G7lContactRow = {
  common: string;
  no: string;
};

/** G7L-1A-T（1 極）の接点表（design.md §4.8） */
export const G7L_1A_CONTACT_ROWS: readonly G7lContactRow[] = [
  { common: "4", no: "6" },
];

/** G7L-2A-T（2 極）の接点表（design.md §4.8） */
export const G7L_2A_CONTACT_ROWS: readonly G7lContactRow[] = [
  { common: "2", no: "4" },
  { common: "6", no: "8" },
];

/** コイルは全型番共通で `0` / `1`。カタログに極性の印字は無い */
const COIL_A = "0";
const COIL_B = "1";

const spread = (index: number, count: number) => (index + 1) / (count + 1);

type G7lRelayOptions = {
  id: string;
  model: string;
  contactRows: readonly G7lContactRow[];
  visual: { width: number; height: number };
};

const buildContacts = (rows: readonly G7lContactRow[]): RelayContact[] =>
  rows.map((row, index) => ({
    id: `c${index + 1}`,
    commonTerminal: row.common,
    noTerminal: row.no,
    // a接点のみなので NC は無い
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
        id: row.no,
        label: row.no,
        number: row.no,
        role: "normally_open",
        contactGroup: `c${order}`,
        description: `端子 ${row.no} / 第${order}接点 NO（a接点）`,
        position: { x: along, y: 0 },
        side: "top",
      },
      {
        id: row.common,
        label: row.common,
        number: row.common,
        role: "common",
        contactGroup: `c${order}`,
        description: `端子 ${row.common} / 第${order}接点 COM`,
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
      role: "coil_negative",
      description: `端子 ${COIL_A} / コイル / DC24V（極性なし）`,
      position: { x: 0, y: 0.35 },
      side: "left",
    },
    {
      id: COIL_B,
      label: COIL_B,
      number: COIL_B,
      role: "coil_positive",
      description: `端子 ${COIL_B} / コイル / DC24V（極性なし）`,
      position: { x: 0, y: 0.65 },
      side: "left",
    },
  ];

  return [...contactTerminals, ...coilTerminals].sort(
    (a, b) => Number(a.id) - Number(b.id),
  );
};

/**
 * G7L シリーズの DC24V リレー定義を組み立てる。
 *
 * 端子データは `G7L_SERIES_SOURCE`（OMRON 公式カタログ CDPA-041C）の
 * 端子配置/内部接続図と突き合わせ済みで **検証済み**（`verified: true`）。
 * コイルは「コイル極性はありません」とカタログに明記されているため
 * `polarity: "none"`。`coil_positive` / `coil_negative` の割り当ては
 * 表示上の便宜的な呼称で、実機の端子 `0` / `1` に +/− の印字は無い
 * （`my-series.ts` の MY4N/MY2N と同じ扱い）。
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
        positiveTerminal: COIL_B,
        negativeTerminal: COIL_A,
        polarity: "none",
      },
      contacts: buildContacts(contactRows),
    },
  },
  visual,
  source: G7L_SERIES_SOURCE,
  verified: true,
});
